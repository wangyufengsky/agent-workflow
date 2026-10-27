import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillName } from '@aw/builtin';
import { BashPolicy, OPENCODE_AGENT_NAME, OPENCODE_ASSISTANT_AGENT, SessionAgent } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { AGENT_SKILLS, ASSISTANT_SKILLS, assistantPermissionRules, sessionPermissionRules } from './opencode.config.ts';

/**
 * Real opencode 1.19.0 (07 §2). Which skills an agent sees is only visible in what opencode sends the model, so a local
 * OpenAI-compatible server stands in for it (as in `opencode.permissions.oc.test.ts`): it records each request and
 * answers with a short text.
 */
const PROVIDER = 'aw-scripted';
const MODEL = 'scripted';
/** Skills planted in the repository and opencode's own: no aw session may see them (D207). */
const FOREIGN = ['repo-agents', 'repo-claude', 'customize-opencode'];

type ModelRequest = { tools?: Array<{ function: { name: string } }> };

async function bodyOf(req: IncomingMessage): Promise<ModelRequest & { stream?: boolean }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Records every request; `next` resolves with the next one that offers tools (an agent's turn, not a title). */
function scriptedModel() {
  const waiting: Array<(request: { body: ModelRequest; raw: string }) => void> = [];
  const server: Server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (body.tools !== undefined && body.tools.length > 0) waiting.shift()?.({ body, raw: JSON.stringify(body) });
      const base = { id: 'chatcmpl-scripted', created: 0, model: MODEL };
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      if (body.stream !== true) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ...base,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
            usage,
          }),
        );
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      const chunk = { ...base, object: 'chat.completion.chunk' };
      send({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] });
      send({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
      res.end('data: [DONE]\n\n');
    });
  });
  return {
    server,
    next: () => new Promise<{ body: ModelRequest; raw: string }>((resolve) => waiting.push(resolve)),
  };
}

const skillFile = (name: string) => `---\nname: ${name}\ndescription: Use when testing.\n---\n\nBody.\n`;

let model: ReturnType<typeof scriptedModel>;
let t: TestApp;
let repo: TestRepo;
beforeAll(async () => {
  model = scriptedModel();
  await new Promise<void>((resolve) => model.server.listen(0, '127.0.0.1', resolve));
  const configFile = join(await mkdtemp(join(tmpdir(), 'aw-oc-skills-')), 'opencode.json');
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
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: configFile } });
  await t.app.start(t.port);
  repo = await createTestRepo({
    files: {
      '.agents/skills/repo-agents/SKILL.md': skillFile('repo-agents'),
      '.claude/skills/repo-claude/SKILL.md': skillFile('repo-claude'),
    },
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((resolve) => model.server.close(resolve));
});

/** One turn of `agent` in the repository: the request opencode sends the model for it. */
async function turnOf(
  agent: string,
  permission: Parameters<TestApp['app']['services']['opencode']['createSession']>[0]['permission'],
) {
  const opencode = t.app.services.opencode;
  const sessionId = await opencode.createSession({
    directory: repo.path,
    title: `skills · ${agent}`,
    agent,
    permission,
  });
  const request = model.next();
  await opencode.prompt({
    sessionId,
    directory: repo.path,
    agent,
    model: { providerId: PROVIDER, modelId: MODEL },
    text: 'hello',
  });
  return request;
}

describe('@opencode 内置 skill（41）', () => {
  it('opencode 找到应用自带的 skill，不扫描仓库里 .agents 与 .claude 下的 skill（D206、D207）', async () => {
    const { data } = await t.app.services.runtime.sdk().app.skills({ directory: repo.path }, { throwOnError: true });
    const names = data.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(Object.values(SkillName)));
    expect(names).not.toContain('repo-agents');
    expect(names).not.toContain('repo-claude');
  });

  it('每个 agent 发给模型的请求里只有分配给它的 skill，没有分配的没有 skill 工具（D207）', async () => {
    const agents = [
      ...Object.values(SessionAgent).map((base) => ({
        agent: OPENCODE_AGENT_NAME[base],
        skills: AGENT_SKILLS[base],
        permission: sessionPermissionRules(base, BashPolicy.Auto),
      })),
      { agent: OPENCODE_ASSISTANT_AGENT, skills: ASSISTANT_SKILLS, permission: assistantPermissionRules() },
    ];
    // One after another: a request is attributed to the only agent whose turn is running.
    for (const { agent, skills, permission } of agents) {
      const { body, raw } = await turnOf(agent, permission);
      const tools = (body.tools ?? []).map((tool) => tool.function.name);
      const seen = [...Object.values(SkillName), ...FOREIGN].filter((name) => raw.includes(name));
      expect({ agent, skillTool: tools.includes('skill'), seen: seen.toSorted() }).toEqual({
        agent,
        skillTool: skills.length > 0,
        seen: [...skills].toSorted(),
      });
    }
  });
});
