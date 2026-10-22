import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BashPolicy, OPENCODE_AGENT_NAME, type PermissionAction, RoleBaseAgent } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { sessionPermissionRules } from './opencode.config.ts';
import { OpencodeEventType, ToolCallStatus } from './opencode.events.ts';

/**
 * Real opencode 1.19.0 decides bash calls of a read-only session with the project's always-allowed patterns (D100,
 * D101). No model is called: a local OpenAI-compatible server (opencode bundles `@ai-sdk/openai-compatible`) answers
 * a prompt `RUN: <command>` with a bash call of that command, and the call's result with a short text.
 */
const PROVIDER = 'aw-scripted';
const MODEL = 'scripted';
const RUN = 'RUN: ';
const PROJECT_PATTERNS = ['./scripts/check.sh -q *'];

const ALLOWED = [
  './scripts/check.sh -q 2>&1 | tail -5',
  'sed -n 1,2p README.md',
  'ls . 2>/dev/null',
  'find . -name "*.md" | sort | uniq -c',
];
// Each is harmless in the temporary repository should it run after all.
const ASKED = [
  './scripts/check.sh -q > out.txt',
  './scripts/check.sh deploy',
  "sed -n '1w copy.txt' README.md",
  'find . -name nothing-here -delete 2>/dev/null',
  'cat README.md | xargs echo',
];

type ChatMessage = { role: string; content: string | Array<{ type: string; text?: string }> | null };

function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? []).map((p) => p.text ?? '').join('');
}

async function bodyOf(req: IncomingMessage): Promise<{ messages: ChatMessage[]; stream?: boolean }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Answers the latest `RUN:` prompt with a bash call, a tool result (or anything else) with text. */
function scriptedModel(): Server {
  return createServer((req, res) => {
    void bodyOf(req).then(({ messages, stream }) => {
      const last = messages.at(-1);
      const prompt = last?.role === 'user' ? textOf(last) : '';
      const command = prompt.includes(RUN) ? prompt.slice(prompt.indexOf(RUN) + RUN.length).trim() : undefined;
      const delta =
        command === undefined
          ? { role: 'assistant', content: 'done' }
          : {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${Math.random().toString(36).slice(2)}`,
                  type: 'function',
                  function: { name: 'bash', arguments: JSON.stringify({ command, description: 'Run the command' }) },
                },
              ],
            };
      const finish = command === undefined ? 'stop' : 'tool_calls';
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      const base = { id: 'chatcmpl-scripted', created: 0, model: MODEL };
      if (stream !== true) {
        const { role: _, ...message } = delta;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ...base,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
            usage,
          }),
        );
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      send({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] });
      send({
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
        usage,
      });
      res.end('data: [DONE]\n\n');
    });
  });
}

let model: Server;
let t: TestApp;
let repo: TestRepo;
beforeAll(async () => {
  model = scriptedModel();
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const configDir = await mkdtemp(join(tmpdir(), 'aw-oc-config-'));
  const configFile = join(configDir, 'opencode.json');
  await writeFile(
    configFile,
    JSON.stringify({
      provider: {
        [PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Scripted',
          options: { baseURL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`, apiKey: 'unused' },
          models: { [MODEL]: { name: 'Scripted', tool_call: true } },
        },
      },
    }),
  );
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: configFile } });
  await t.app.start(t.port);
  repo = await createTestRepo({ files: { 'scripts/check.sh': '#!/bin/sh\necho ok\n' } });
  await chmod(join(repo.path, 'scripts', 'check.sh'), 0o755);
});
afterAll(async () => {
  await t.close();
  await new Promise((resolve) => model.close(resolve));
});

/** Runs `command` in a new reviewer session: `allow` once the bash call completes, `ask` once opencode asks. */
async function decide(command: string): Promise<PermissionAction> {
  const opencode = t.app.services.opencode;
  const agent = OPENCODE_AGENT_NAME[RoleBaseAgent.Reviewer];
  const sessionId = await opencode.createSession({
    directory: repo.path,
    title: `permissions · ${command}`,
    agent,
    permission: sessionPermissionRules(RoleBaseAgent.Reviewer, BashPolicy.Auto, { allowedBash: PROJECT_PATTERNS }),
  });
  const { promise, resolve } = Promise.withResolvers<PermissionAction>();
  const unsubscribe = opencode.subscribe((event) => {
    if (!('sessionId' in event) || event.sessionId !== sessionId) return;
    if (event.type === OpencodeEventType.PermissionAsked) {
      resolve('ask');
      void opencode.replyPermission({ permissionId: event.permissionId, directory: repo.path, reply: 'reject' });
    }
    if (event.type === OpencodeEventType.Tool && event.tool === 'bash' && event.status === ToolCallStatus.Completed)
      resolve('allow');
  });
  try {
    await opencode.prompt({
      sessionId,
      directory: repo.path,
      agent,
      model: { providerId: PROVIDER, modelId: MODEL },
      text: `${RUN}${command}`,
    });
    return await promise;
  } finally {
    unsubscribe();
  }
}

describe('@opencode 只读会话的 bash 规则与项目中总是允许的模式', () => {
  it('opencode 放行白名单与项目模式（带结尾的 stderr 重定向），逃逸写法与其他命令照常询问', async () => {
    const commands = [...ALLOWED, ...ASKED];
    const decisions = await Promise.all(commands.map(decide));
    expect(Object.fromEntries(commands.map((c, i) => [c, decisions[i]]))).toEqual({
      ...Object.fromEntries(ALLOWED.map((c) => [c, 'allow'])),
      ...Object.fromEntries(ASKED.map((c) => [c, 'ask'])),
    });
  });
});
