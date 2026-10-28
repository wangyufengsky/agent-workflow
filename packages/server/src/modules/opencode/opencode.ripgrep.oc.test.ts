import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { SkillName } from '@aw/builtin';
import { OPENCODE_ASSISTANT_AGENT } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { host } from '../../core/platform.ts';
import { assistantPermissionRules } from './opencode.config.ts';

/**
 * Real opencode 1.19.0 (07 §2) on a machine like the intranet ones (D213): no `rg` on PATH, none in opencode's data
 * cache, and no way to download one. The skill tool lists the skill's files with ripgrep, so it only works with
 * the ripgrep the app brings. A local OpenAI-compatible server plays the model: it loads one skill and records what
 * the tool answered.
 */
const PROVIDER = 'aw-scripted';
const MODEL = 'scripted';
const SKILL = SkillName.TaskRequirement;

type ChatMessage = { role: string; content: string | Array<{ type: string; text?: string }> | null };

async function bodyOf(req: IncomingMessage): Promise<{ messages: ChatMessage[]; tools?: unknown[]; stream?: boolean }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const textOf = (message: ChatMessage) =>
  typeof message.content === 'string' ? message.content : (message.content ?? []).map((p) => p.text ?? '').join('');

/** Calls the skill tool on the agent's turn; `toolResult` resolves with what the tool answered. */
function scriptedModel() {
  const { promise: toolResult, resolve } = Promise.withResolvers<string>();
  const server: Server = createServer((req, res) => {
    void bodyOf(req).then(({ messages, tools, stream }) => {
      const last = messages.at(-1);
      if (last?.role === 'tool') resolve(textOf(last));
      const call = tools !== undefined && tools.length > 0 && last?.role === 'user';
      const delta = call
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_skill',
                type: 'function',
                function: { name: 'skill', arguments: JSON.stringify({ name: SKILL }) },
              },
            ],
          }
        : { role: 'assistant', content: 'done' };
      const finish = call ? 'tool_calls' : 'stop';
      const base = { id: 'chatcmpl-scripted', created: 0, model: MODEL };
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      if (stream !== true) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ...base,
            object: 'chat.completion',
            choices: [{ index: 0, message: delta, finish_reason: finish }],
            usage,
          }),
        );
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      const chunk = { ...base, object: 'chat.completion.chunk' };
      send({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] });
      send({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage });
      res.end('data: [DONE]\n\n');
    });
  });
  return { server, toolResult };
}

let model: ReturnType<typeof scriptedModel>;
let t: TestApp;
let repo: TestRepo;
beforeAll(async () => {
  model = scriptedModel();
  await new Promise<void>((resolve) => model.server.listen(0, '127.0.0.1', resolve));
  const scratch = await mkdtemp(join(tmpdir(), 'aw-oc-ripgrep-'));
  const configFile = join(scratch, 'opencode.json');
  await writeFile(
    configFile,
    JSON.stringify({
      provider: {
        [PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Scripted',
          options: {
            baseURL: `http://127.0.0.1:${(model.server.address() as AddressInfo).port}/v1`,
            apiKey: 'unused',
          },
          models: { [MODEL]: { name: 'Scripted', tool_call: true } },
        },
      },
    }),
  );
  // The app's ripgrep: this machine's, linked into a directory of its own.
  const dirs = host.pathDirs(process.env);
  const rg = host.findExecutable('rg', dirs);
  if (rg === undefined) throw new Error('these tests need rg on PATH to stand in for the bundled one');
  const ripgrepDir = join(scratch, 'ripgrep');
  await mkdir(ripgrepDir);
  await symlink(rg, join(ripgrepDir, 'rg'));
  t = await createTestApp({
    realOpencode: true,
    configEnv: { AW_RIPGREP_DIR: ripgrepDir },
    env: {
      ...process.env,
      OPENCODE_CONFIG: configFile,
      // No rg of the machine's, none downloaded before (opencode keeps it in its cache), and GitHub out of reach.
      PATH: dirs.filter((dir) => host.findExecutable('rg', [dir]) === undefined).join(delimiter),
      XDG_CACHE_HOME: join(scratch, 'cache'),
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    },
  });
  await t.app.start(t.port);
  repo = await createTestRepo();
});
afterAll(async () => {
  await t.close();
  await new Promise((resolve) => model.server.close(resolve));
});

describe('@opencode 应用自带 ripgrep（D213）', () => {
  it('本机没有 rg 也下载不了时，助手照样能加载 skill', async () => {
    const opencode = t.app.services.opencode;
    const sessionId = await opencode.createSession({
      directory: repo.path,
      title: 'ripgrep · skill',
      agent: OPENCODE_ASSISTANT_AGENT,
      permission: assistantPermissionRules(),
    });
    await opencode.prompt({
      sessionId,
      directory: repo.path,
      agent: OPENCODE_ASSISTANT_AGENT,
      model: { providerId: PROVIDER, modelId: MODEL },
      text: 'load the skill',
    });
    const answer = await model.toolResult;
    expect(answer).not.toContain('ripgrep');
    expect(answer).toContain(SKILL);
  });
});
