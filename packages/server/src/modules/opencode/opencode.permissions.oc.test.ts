import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttemptKind,
  AttemptStatus,
  BashPolicy,
  cancelTaskOp,
  ErrorCode,
  getNodeOp,
  InboxKind,
  listInboxOp,
  MCP_TOOL_PREFIX,
  McpToolName,
  NodeStatus,
  OPENCODE_AGENT_NAME,
  type PermissionAction,
  PermissionDecision,
  RoleBaseAgent,
  resolveInboxOp,
  ServerEventType,
  TranscriptSystemEvent,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { addProject, createTask, inboxOpens, nodeReaches, taskReaches } from '../../../test/helpers/tasks.ts';
import { sessionPermissionRules } from './opencode.config.ts';
import { OpencodeEventType, ToolCallStatus } from './opencode.events.ts';

/**
 * Real opencode 1.19.0 decides bash calls of a read-only session with the project's always-allowed patterns (D100,
 * D101). No model is called: a local OpenAI-compatible server (opencode bundles `@ai-sdk/openai-compatible`) answers
 * a prompt `RUN: <command>` with a bash call of that command, and the call's result with a short text.
 */
const PROVIDER = 'aw-scripted';
const PROJECT_PROVIDER = 'aw-project-scripted';
const MODEL = 'scripted';
const RUN = 'RUN: ';
const PROJECT_PATTERNS = ['./scripts/check.sh -q *'];
const PROBE_PARENT = 'VERIFY_MANAGED_DELEGATION';
const PROBE_SESSION_COMMAND = 'VERIFY_SESSION_COMMAND_BOUNDARIES';
const transportTrace: Array<{ command: string; args: string; sessionId: string } | 'task'> = [];
const PROBE_CHILD = 'FIND_COMMITTED_PROBE';
const PROBE_EVIDENCE = 'sample-repository-marker';
const PROJECT_INSTRUCTION = 'project-instruction-marker';
const advertisedParent = new Set<string>();
const advertisedChild = new Set<string>();
const childReads: string[] = [];
const childPrompts: string[] = [];

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

async function bodyOf(req: IncomingMessage): Promise<{
  messages: ChatMessage[];
  stream?: boolean;
  tools?: Array<{ function: { name: string } }>;
}> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Answers the latest `RUN:` prompt with a bash call, a tool result (or anything else) with text. */
async function recordCommand(req: IncomingMessage) {
  const data: Buffer[] = [];
  for await (const chunk of req) data.push(chunk as Buffer);
  transportTrace.push(JSON.parse(Buffer.concat(data).toString('utf8')));
}

function scriptedModel(): Server {
  return createServer((req, res) => {
    if (req.url === '/session-command-probe') {
      void recordCommand(req).then(() => res.end());
      return;
    }
    void bodyOf(req).then(({ messages, stream, tools }) => {
      const last = messages.at(-1);
      const prompt = last?.role === 'user' ? textOf(last) : '';
      const command = prompt.includes(RUN) ? prompt.slice(prompt.indexOf(RUN) + RUN.length).trim() : undefined;
      const hasProbe = (marker: string) => messages.some((m) => m.role === 'user' && textOf(m).includes(marker));
      const names = (tools ?? []).map((tool) => tool.function.name);
      const operation = (name: McpToolName, args: Record<string, unknown>) => ({
        name: `${MCP_TOOL_PREFIX}${name}`,
        args,
      });
      let calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      if (hasProbe(PROBE_CHILD)) {
        for (const name of names) advertisedChild.add(name);
        childPrompts.push(...messages.map(textOf));
        if (last?.role === 'tool') {
          childReads.push(textOf(last));
          calls = [operation(McpToolName.SubmitDelegation, { summary: 'src.ts:1 contains the sample marker' })];
        } else calls = [operation(McpToolName.InspectDelegation, { action: 'read', path: 'src.ts' })];
      } else if (hasProbe(PROBE_PARENT)) {
        for (const name of names) advertisedParent.add(name);
        calls =
          last?.role === 'tool'
            ? [operation(McpToolName.SubmitResult, { summary: 'Received the managed delegation', notes: textOf(last) })]
            : [operation(McpToolName.DelegateReadonly, { questions: [PROBE_CHILD] })];
      } else if (prompt.includes(PROBE_SESSION_COMMAND)) {
        transportTrace.push('task');
        calls = [operation(McpToolName.SubmitResult, { summary: 'Task received after the start command' })];
      } else if (command !== undefined) {
        calls = command
          .split('\n')
          .map((command) => ({ name: 'bash', args: { command, description: 'Run the command' } }));
      }
      const delta =
        calls.length === 0
          ? { role: 'assistant', content: 'done' }
          : {
              role: 'assistant',
              tool_calls: calls.map(({ name, args }, index) => ({
                index,
                id: `call_${Math.random().toString(36).slice(2)}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              })),
            };
      const finish = calls.length === 0 ? 'stop' : 'tool_calls';
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

function providerFor(model: Server) {
  return {
    npm: '@ai-sdk/openai-compatible',
    name: 'Scripted',
    options: { baseURL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`, apiKey: 'unused' },
    models: { [MODEL]: { name: 'Scripted', tool_call: true } },
  };
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
        [PROVIDER]: providerFor(model),
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
  let reply: Promise<void> | undefined;
  const unsubscribe = opencode.subscribe((event) => {
    if (!('sessionId' in event) || event.sessionId !== sessionId) return;
    if (event.type === OpencodeEventType.PermissionAsked) {
      resolve('ask');
      reply = opencode.replyPermission({ permissionId: event.permissionId, directory: repo.path, reply: 'reject' });
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
    await reply;
  }
}

describe('@opencode 只读会话的 bash 规则与项目中总是允许的模式', () => {
  it('并行 find 请求：总是允许后两条都收到答复事件，再答复已完成请求返回失效错误', async () => {
    const isolatedRepo = await createTestRepo();
    const opencode = t.app.services.opencode;
    const agent = OPENCODE_AGENT_NAME[RoleBaseAgent.Reviewer];
    const sessionId = await opencode.createSession({
      directory: isolatedRepo.path,
      title: 'Concurrent permissions',
      agent,
      permission: sessionPermissionRules(RoleBaseAgent.Reviewer, BashPolicy.Ask),
    });
    const asked: string[] = [];
    const replied: string[] = [];
    const pending = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    const unsubscribe = opencode.subscribe((event) => {
      if (!('sessionId' in event) || event.sessionId !== sessionId) return;
      if (event.type === OpencodeEventType.PermissionAsked) {
        asked.push(event.permissionId);
        if (asked.length === 2) pending.resolve();
      }
      if (event.type === OpencodeEventType.PermissionReplied) {
        replied.push(event.permissionId);
        if (replied.length === 2) done.resolve();
      }
    });
    try {
      await opencode.prompt({
        sessionId,
        directory: isolatedRepo.path,
        agent,
        model: { providerId: PROVIDER, modelId: MODEL },
        text: `${RUN}find . -name README.md -exec cat {} \\;\nfind . -name package.json -exec cat {} \\;`,
      });
      await pending.promise;
      const permissionId = asked[0];
      if (permissionId === undefined) throw new Error('missing native permission');
      await opencode.replyPermission({ permissionId, directory: isolatedRepo.path, reply: 'always' });
      await done.promise;
      expect(replied.sort()).toEqual([...asked].sort());
      await expect(
        opencode.replyPermission({ permissionId, directory: isolatedRepo.path, reply: 'once' }),
      ).rejects.toMatchObject({ code: ErrorCode.PermissionRequestExpired });
    } finally {
      unsubscribe();
      await opencode.abort({ sessionId, directory: isolatedRepo.path });
    }
  });

  it('opencode 放行白名单与项目模式（带结尾的 stderr 重定向），逃逸写法与其他命令照常询问', async () => {
    const commands = [...ALLOWED, ...ASKED];
    const decisions = await Promise.all(commands.map(decide));
    expect(Object.fromEntries(commands.map((c, i) => [c, decisions[i]]))).toEqual({
      ...Object.fromEntries(ALLOWED.map((c) => [c, 'allow'])),
      ...Object.fromEntries(ASKED.map((c) => [c, 'ask'])),
    });
  });
});

it('@opencode 委派沿用项目模型、读取固定提交，并隔离原生工具与项目指令', async () => {
  await t.call(updateSettingsOp, { 'ai.defaultModel': null, 'scheduler.maxConcurrentAttempts': 3 });
  const projectModel = `${PROJECT_PROVIDER}/${MODEL}`;
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      'src.ts': PROBE_EVIDENCE,
      'project-rules.md': PROJECT_INSTRUCTION,
      'opencode.json': JSON.stringify({
        model: projectModel,
        provider: { [PROJECT_PROVIDER]: providerFor(model) },
        instructions: ['project-rules.md'],
      }),
    },
  });
  expect(
    (await t.app.services.opencode.listModels()).available.some((item) => item.providerId === PROJECT_PROVIDER),
  ).toBe(false);
  const complete = nodeReaches(t, 'locate', NodeStatus.AwaitingAcceptance, 45_000);
  const task = await createTask(t, {
    projectId: project.id,
    workflow: 'bugfix',
    requirement: PROBE_PARENT,
    checkpoints: { accept_each_node: true },
  });
  try {
    const { node } = await complete;
    const detail = (await t.call(getNodeOp, { id: task.id, nodeId: node.id })).body;
    expect(detail.result?.notes).toContain('src.ts:1 contains the sample marker');
    expect(detail.attempts.filter((attempt) => attempt.kind === AttemptKind.Delegation)).toMatchObject([
      { status: AttemptStatus.Succeeded, model: projectModel },
    ]);
    expect(advertisedParent).toContain(`${MCP_TOOL_PREFIX}${McpToolName.DelegateReadonly}`);
    expect(advertisedParent).not.toContain('task');
    expect(advertisedChild).toContain(`${MCP_TOOL_PREFIX}${McpToolName.InspectDelegation}`);
    expect(advertisedChild).toContain(`${MCP_TOOL_PREFIX}${McpToolName.SubmitDelegation}`);
    for (const name of [
      'bash',
      'read',
      'edit',
      'write',
      'task',
      'webfetch',
      `${MCP_TOOL_PREFIX}${McpToolName.DelegateReadonly}`,
    ])
      expect(advertisedChild).not.toContain(name);
    expect(childReads.some((result) => result.includes(PROBE_EVIDENCE))).toBe(true);
    expect(childPrompts.join(' ')).not.toContain(PROJECT_INSTRUCTION);
  } finally {
    await t.call(cancelTaskOp, { id: task.id });
  }
}, 60_000);

it('@opencode 在同一开发会话执行首尾斜杠命令，插件可用该会话 id 上报', async () => {
  await t.call(updateSettingsOp, {
    'ai.defaultModel': `${PROVIDER}/${MODEL}`,
    'ai.sessionStartCommand': '/session-probe start',
    'ai.sessionEndCommand': '/session-probe complete',
  });
  const endpoint = `http://127.0.0.1:${(model.address() as AddressInfo).port}/session-command-probe`;
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      'opencode.json': JSON.stringify({
        command: { 'session-probe': { template: 'Report the boundary: $ARGUMENTS' } },
      }),
      '.opencode/plugins/session-command-probe.js': `
        export default async () => ({
          'command.execute.before': async ({ command, arguments: args, sessionID: sessionId }) => {
            await fetch(${JSON.stringify(endpoint)}, {
              method: 'POST', body: JSON.stringify({ command, args, sessionId }),
            });
          },
        });
      `,
    },
  });
  const completed = nodeReaches(t, 'build_page', NodeStatus.Done, 45_000);
  const task = await createTask(t, { projectId: project.id, workflow: 'frontend', requirement: PROBE_SESSION_COMMAND });
  try {
    const { node } = await completed;
    await t.app.services.attempts.waitForEndCommands(task.id);
    const detail = (await t.call(getNodeOp, { id: task.id, nodeId: node.id })).body;
    const [summary] = detail.attempts;
    if (summary === undefined) throw new Error('No development attempt');
    const attempt = t.app.services.attempts.get(summary.id);
    expect(detail.result?.summary).toBe('Task received after the start command');
    expect(transportTrace).toEqual([
      { command: 'session-probe', args: 'start', sessionId: attempt.opencodeSessionId },
      'task',
      { command: 'session-probe', args: 'complete', sessionId: attempt.opencodeSessionId },
    ]);
    const messages = t.app.services.attempts.transcript(attempt.id, 0).entries;
    expect(messages.filter((entry) => entry.kind === 'user_message').map((entry) => entry.data.text)).toEqual([
      '/session-probe start',
      expect.stringContaining(PROBE_SESSION_COMMAND),
      '/session-probe complete',
    ]);
  } finally {
    await t.call(cancelTaskOp, { id: task.id });
  }
}, 60_000);

it('@opencode 开始命令不可用时提示，原开发会话照常交付结果', async () => {
  await t.call(updateSettingsOp, {
    'ai.defaultModel': `${PROVIDER}/${MODEL}`,
    'ai.sessionStartCommand': '/aw-unregistered-start-command',
    'ai.sessionEndCommand': null,
    'node.maxAttempts': 1,
  });
  const { project } = await addProject(t, { checkCommand: null });
  const terminal = waitForEvent(
    t.app.events,
    ServerEventType.NodeUpdated,
    ({ node }) => node.key === 'build_page' && (node.status === NodeStatus.Done || node.status === NodeStatus.Failed),
  );
  const task = await createTask(t, { projectId: project.id, workflow: 'frontend', requirement: PROBE_SESSION_COMMAND });
  try {
    const { node } = await terminal;
    expect(node.status).toBe(NodeStatus.Done);
    const { body: detail } = await t.call(getNodeOp, { id: task.id, nodeId: node.id });
    expect(detail.attempts).toHaveLength(1);
    const [attempt] = detail.attempts;
    if (attempt === undefined) throw new Error('No development attempt');
    const entries = t.app.services.attempts.transcript(attempt.id, 0).entries;
    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: 'system',
        data: { event: TranscriptSystemEvent.SessionStartCommandFailed },
      }),
    );
  } finally {
    await t.call(cancelTaskOp, { id: task.id });
  }
}, 45_000);

it('@opencode 结束命令需要权限时可以授权，保留已提交结果', async () => {
  await t.call(updateSettingsOp, {
    'ai.defaultModel': `${PROVIDER}/${MODEL}`,
    'ai.bashPolicy': BashPolicy.Ask,
    'ai.sessionStartCommand': null,
    'ai.sessionEndCommand': '/end-with-permission',
  });
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      'opencode.json': JSON.stringify({
        command: { 'end-with-permission': { template: `${RUN}find . -name nothing-here -delete` } },
      }),
    },
  });
  const submitted = nodeReaches(t, 'build_page', NodeStatus.Done);
  const requested = inboxOpens(t, InboxKind.Permission);
  const task = await createTask(t, { projectId: project.id, workflow: 'frontend', requirement: PROBE_SESSION_COMMAND });
  const { node } = await submitted;
  const { body: detail } = await t.call(getNodeOp, { id: task.id, nodeId: node.id });
  const [summary] = detail.attempts;
  if (summary === undefined) throw new Error('No submitted attempt');
  const attempt = t.app.services.attempts.get(summary.id);
  try {
    const { item } = await requested;
    expect(item).toMatchObject({ taskId: task.id, payload: { permission: 'bash' } });
    if (item.attemptId === null) throw new Error('Permission is missing its attempt');
    expect(t.app.services.attempts.get(item.attemptId).status).toBe(AttemptStatus.Succeeded);
    const review = taskReaches(t, 'review', 25_000);
    const reply = await t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Once } });
    expect(reply.body.status).toBe('resolved');
    await review;
    expect(t.app.services.attempts.get(item.attemptId).status).toBe(AttemptStatus.Succeeded);
    expect((await t.call(listInboxOp, { taskId: task.id, blocking: true, status: 'open' })).body.items).toEqual([]);
  } finally {
    if (attempt.opencodeSessionId !== null) {
      await t.app.services.opencode.abort({ sessionId: attempt.opencodeSessionId, directory: attempt.directory });
    }
    await t.call(cancelTaskOp, { id: task.id });
  }
}, 45_000);
