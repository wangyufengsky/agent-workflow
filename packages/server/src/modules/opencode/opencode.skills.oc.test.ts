import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillName, WORKFLOW_SKILLS } from '@aw/builtin';
import {
  BashPolicy,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  getOpencodeHeadersOp,
  MCP_TOOL_PREFIX,
  McpToolName,
  OPENCODE_AGENT_NAME,
  OPENCODE_ASSISTANT_AGENT,
  OPENCODE_FUNCTIONAL_TEST_AGENT,
  restartRuntimeOp,
  SessionAgent,
  setOpencodeHeadersOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { AGENT_SKILLS, ASSISTANT_SKILLS, assistantPermissionRules, sessionPermissionRules } from './opencode.config.ts';

/**
 * Real opencode 1.19.0 (07 §2). Which skills an agent sees is only visible in what opencode sends the model, so a local
 * OpenAI-compatible server stands in for it (as in `opencode.permissions.oc.test.ts`): it records each request and
 * answers with a short text.
 */
const PROVIDER = 'aw-scripted';
const MODEL = 'scripted';
type ModelRequest = { requestHeaders?: IncomingMessage['headers']; tools?: Array<{ function: { name: string } }> };

async function bodyOf(req: IncomingMessage): Promise<ModelRequest & { stream?: boolean }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Records every request; `next` resolves with the next one that offers tools (an agent's turn, not a title). */
function scriptedModel() {
  const waiting: Array<(request: ModelRequest) => void> = [];
  const server: Server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (body.tools !== undefined && body.tools.length > 0)
        waiting.shift()?.({ ...body, requestHeaders: req.headers });
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
    next: () => new Promise<ModelRequest>((resolve) => waiting.push(resolve)),
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
  t = await createTestApp({
    realOpencode: true,
    cipher: testCipher,
    env: { ...process.env, OPENCODE_CONFIG: configFile },
  });
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
  directory = repo.path,
) {
  const opencode = t.app.services.opencode;
  const sessionId = await opencode.createSession({
    directory,
    title: `skills · ${agent}`,
    agent,
    permission,
  });
  const request = model.next();
  await opencode.prompt({
    sessionId,
    directory,
    agent,
    model: { providerId: PROVIDER, modelId: MODEL },
    text: 'hello',
  });
  return request;
}

function offeredSkills(body: ModelRequest): string[] {
  // OpenCode advertises Skill availability in a separate section of its system message.
  const list = /<available_skills>(.*?)<\/available_skills>/.exec(JSON.stringify(body))?.[1];
  return list === undefined
    ? []
    : [...list.matchAll(/<name>([^<]+)<\/name>/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
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
      const body = await turnOf(agent, permission);
      const tools = (body.tools ?? []).map((tool) => tool.function.name);
      const seen = offeredSkills(body);
      expect({ agent, skillTool: tools.includes('skill'), seen: seen.toSorted() }).toEqual({
        agent,
        skillTool: skills.length > 0,
        seen: [...skills].toSorted(),
      });
    }
  });
  it('功能测试导入会话只看到专用 Skill，不能通过命令、文件或浏览器操作测试目标', async () => {
    const body = await turnOf(
      OPENCODE_FUNCTIONAL_TEST_AGENT,
      sessionPermissionRules(SessionAgent.Executor, BashPolicy.Auto, {
        functionalTestNode: FUNCTIONAL_TEST_NODE.Import,
      }),
    );
    const tools = (body.tools ?? []).map((tool) => tool.function.name);
    const seen = offeredSkills(body);
    expect(seen.toSorted()).toEqual([...WORKFLOW_SKILLS[FUNCTIONAL_TEST_WORKFLOW_KEY]].toSorted());
    expect(tools).toEqual(expect.arrayContaining(['skill', `${MCP_TOOL_PREFIX}${McpToolName.ReadAttachment}`]));
    for (const tool of ['bash', 'edit', 'read', `${MCP_TOOL_PREFIX}${McpToolName.BrowserOpen}`]) {
      expect(tools).not.toContain(tool);
    }
  });
  it('浏览器测试会话可以读取识图 Skill 并调用识图工具', async () => {
    const body = await turnOf(
      OPENCODE_AGENT_NAME[SessionAgent.Executor],
      sessionPermissionRules(SessionAgent.Executor, BashPolicy.Auto, {
        browserTestSubmit: McpToolName.BrowserSubmitReport,
      }),
    );
    expect(body.tools?.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['skill', `${MCP_TOOL_PREFIX}${McpToolName.AnalyzeImage}`]),
    );
  });
});

it('真实 OpenCode 向模型发送多个自定义请求头，重启后移除已删除的头', async () => {
  const items = [
    { name: 'X-Workflow-Client', secret: false, value: 'agent-workflow' },
    { name: 'X-Workflow-Key', secret: true, value: 'fixture-header-secret' },
    { name: 'Authorization', secret: true, value: 'Bearer fixture-override' },
  ];
  expect((await t.call(setOpencodeHeadersOp, { items })).status).toBe(200);
  expect((await t.call(getOpencodeHeadersOp, {})).body.items).toEqual([
    items[0],
    { name: 'X-Workflow-Key', secret: true },
    { name: 'Authorization', secret: true },
  ]);
  expect((await t.call(restartRuntimeOp, {})).body.status).toBe('ready');
  const send = () => turnOf(OPENCODE_ASSISTANT_AGENT, assistantPermissionRules());
  const first = await send();
  expect(first.requestHeaders).toMatchObject({
    'x-workflow-client': 'agent-workflow',
    'x-workflow-key': 'fixture-header-secret',
    authorization: 'Bearer fixture-override',
  });
  expect(JSON.stringify(await t.app.services.runtime.sdk().config.get()).includes('fixture-header-secret')).toBe(false);
  const other = await createTestRepo();
  const worker = await turnOf(
    OPENCODE_AGENT_NAME[SessionAgent.Executor],
    sessionPermissionRules(SessionAgent.Executor, BashPolicy.Auto),
    other.path,
  );
  expect(worker.requestHeaders?.['x-workflow-key']).toBe('fixture-header-secret');
  await t.call(setOpencodeHeadersOp, { items: [] });
  expect((await t.call(restartRuntimeOp, {})).body.status).toBe('ready');
  const after = await send();
  expect(after.requestHeaders).not.toHaveProperty('x-workflow-key');
  expect(after.requestHeaders).not.toHaveProperty('x-workflow-client');
  expect(after.requestHeaders?.authorization).toBe('Bearer unused');
});
