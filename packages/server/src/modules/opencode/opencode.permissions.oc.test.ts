import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  AttemptKind,
  AttemptStatus,
  askKnowledgeOp,
  BashPolicy,
  cancelTaskOp,
  createDesignOp,
  DesignSectionKind,
  ErrorCode,
  generateDesignOp,
  getAttemptContextOp,
  getDesignOp,
  getKnowledgeOp,
  getNodeOp,
  InboxKind,
  listInboxOp,
  MCP_TOOL_PREFIX,
  McpToolName,
  NodeStatus,
  OPENCODE_AGENT_NAME,
  type PermissionAction,
  PermissionDecision,
  PermissionMode,
  RoleBaseAgent,
  resolveInboxOp,
  reviseDesignOutlineOp,
  reviseDesignSectionOp,
  ServerEventType,
  TranscriptSystemEvent,
  updateDesignOutlineOp,
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
const CONTEXT_PROBE = 'AW_CHECK_REQUEST_PROJECTION';
const DISABLE_PROBE = 'AW_DISABLE_AFTER_PROJECTION';
const SUMMARY_PROBE = 'AW_CHECK_BACKGROUND_SUMMARY';
const workerStarted = Promise.withResolvers<void>();
const newReadProduced = Promise.withResolvers<void>();
const summarySaved = Promise.withResolvers<void>();
const workerTools: string[][] = [];
const RECALL_PROBE = 'AW_CHECK_PAGED_RECALL';
const FOREIGN_PROBE = 'AW_CHECK_FOREIGN_RECALL';
const coordinates = /messageId=(msg_\w+) partId=(prt_\w+)/;
let overflowStage = 0;
const contextRequests: ChatMessage[][] = [];
let foregroundRequests = 0;
const EFFORT_PROBE = 'VERIFY_MODEL_EFFORT';
const sentEfforts: Array<string | undefined> = [];
const RUN = 'RUN: ';
const RESEARCH_PERMISSION_PROBE = 'VERIFY_RESEARCH_PERMISSION';
const RESEARCH_CHECKSUM = 'cksum README.md';
const DESIGN_SEARCH_PROBE = 'VERIFY_DESIGN_SEARCH_PIPELINE';
const PROJECT_PATTERNS = ['./scripts/check.sh -q *'];
const PROBE_PARENT = 'VERIFY_MANAGED_DELEGATION';
const DESIGN_MCP_PROBE = 'VERIFY_DESIGN_ACCOUNTING';
const accountingToolMenus: string[][] = [];
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

type ChatMessage = {
  tool_call_id?: string;
  tool_calls?: { id: string }[];
  role: string;
  content: string | Array<{ type: string; text?: string }> | null;
};

function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? []).map((p) => p.text ?? '').join('');
}

async function bodyOf(req: IncomingMessage): Promise<{
  reasoning_effort?: string;
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
    if (req.url === '/summary-read-produced') {
      newReadProduced.resolve();
      void summarySaved.promise.then(() => res.end());
      return;
    }
    if (req.url === '/session-command-probe') {
      void recordCommand(req).then(() => res.end());
      return;
    }
    void bodyOf(req).then(async ({ messages, stream, tools, reasoning_effort }) => {
      const last = messages.at(-1);
      const prompt = last?.role === 'user' ? textOf(last) : '';
      if (prompt.startsWith(EFFORT_PROBE)) sentEfforts.push(reasoning_effort);
      const command = prompt.includes(RUN) ? prompt.slice(prompt.indexOf(RUN) + RUN.length).trim() : undefined;
      const hasProbe = (marker: string) => messages.some((m) => m.role === 'user' && textOf(m).includes(marker));
      const names = (tools ?? []).map((tool) => tool.function.name);
      const operation = (name: McpToolName, args: Record<string, unknown>) => ({
        name: `${MCP_TOOL_PREFIX}${name}`,
        args,
      });
      let calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const summaryRequest = messages.some(
        (m) => m.role === 'system' && textOf(m).includes('Summarize the supplied prior work'),
      );
      // 摘要由独立会话异步生成；停用投影的断言统计前台请求。
      if (!summaryRequest) foregroundRequests++;
      let replyText = 'done';
      if (prompt.startsWith('{"userRequest":"VERIFY_RESEARCH_PERMISSION')) {
        replyText = JSON.stringify({ decision: 'once', reason: 'Verified repository checksum' });
      } else if (hasProbe(DESIGN_SEARCH_PROBE)) {
        const output = messages.find((m) => m.role === 'tool');
        calls = output
          ? [
              operation(McpToolName.SubmitDesignOutline, {
                sections: [{ kind: 'module', title: textOf(output).trim(), scopePaths: ['README.md'] }],
              }),
            ]
          : [
              {
                name: 'bash',
                args: {
                  command: "grep -oE 'ITEM_[A-Z]+' README.md | sort -u | comm -23 - known.txt",
                  description: 'Compare references',
                },
              },
            ];
      } else if (hasProbe(RESEARCH_PERMISSION_PROBE)) {
        calls = messages.some((m) => m.role === 'tool')
          ? [operation(McpToolName.SubmitAnswer, { answer: 'Repository checked.', citations: [] })]
          : [{ name: 'bash', args: { command: RESEARCH_CHECKSUM, description: 'Read the repository checksum' } }];
      } else if (summaryRequest) {
        if (messages.some((m) => m.role === 'user' && textOf(m).includes('EARLY_FINDING'))) {
          workerTools.push(names);
          workerStarted.resolve();
          await newReadProduced.promise;
          replyText = 'Verified the early finding in bulk.txt.';
        } else {
          replyText = 'Summarized the supplied work.';
        }
      } else if (overflowStage === 2 && names.length === 0) {
        overflowStage = 3;
        replyText = `${SUMMARY_PROBE} Continue the task using new evidence.`;
      } else if (messages.some((m) => textOf(m).includes(SUMMARY_PROBE))) {
        if (overflowStage === 0) {
          overflowStage = 1;
          calls = [{ name: 'read', args: { filePath: 'latest.txt' } }];
        } else if (overflowStage === 1) {
          overflowStage = 2;
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                message: "This model's maximum context length is 32000 tokens. Please reduce your input.",
                code: 'context_length_exceeded',
                type: 'invalid_request_error',
              },
            }),
          );
          return;
        } else {
          contextRequests.push(messages);
          const count = messages.filter((m) => m.role === 'tool').length;
          if (messages.some((m) => textOf(m).includes('[AW prior work]'))) {
            const evidence = messages
              .filter((m) => m.role === 'tool')
              .map(textOf)
              .join('\n');
            calls = [
              operation(McpToolName.SubmitResult, {
                summary: 'Finished with summary',
                notes:
                  evidence.includes('EVIDENCE_AFTER_FREEZE') && evidence.includes('Latest batch before worker')
                    ? 'Used old and new evidence alongside the summary'
                    : 'missing evidence',
              }),
            ];
          } else if (count === 0) calls = [{ name: 'grep', args: { pattern: 'EARLY_FINDING', include: 'bulk.txt' } }];
          else if (count === 1) calls = [{ name: 'read', args: { filePath: 'latest.txt' } }];
          else if (count === 2) {
            await workerStarted.promise;
            calls = [{ name: 'read', args: { filePath: 'new.txt' } }];
          } else calls = [operation(McpToolName.SubmitResult, { summary: 'Missing summary' })];
        }
      } else if (hasProbe(RECALL_PROBE) || hasProbe(FOREIGN_PROBE)) {
        contextRequests.push(messages);
        const outputs = messages.filter((m) => m.role === 'tool').map(textOf);
        const userPrompt = messages
          .filter((m) => m.role === 'user')
          .map(textOf)
          .join('\n');
        const sectionId = /本轮目标章节 ID：([\w-]+)/.exec(userPrompt)?.[1];
        const submit = (summary: string) =>
          operation(McpToolName.SubmitDesignSection, {
            sectionId,
            summary,
            blocks: [{ type: 'markdown', markdown: summary }],
            files: [],
            diagrams: [],
          });
        const ref = coordinates.exec(hasProbe(FOREIGN_PROBE) ? userPrompt : (outputs[0] ?? ''));
        const offset = /"nextOffset"\s*:\s*(\d+)/.exec(outputs[2] ?? '')?.[1];
        if (hasProbe(FOREIGN_PROBE) && ref) {
          calls =
            outputs.length === 0
              ? [operation(McpToolName.Recall, { messageId: ref[1], partId: ref[2] })]
              : [submit(outputs[0] ?? '')];
        } else if (outputs.length < 2) {
          calls = [{ name: 'read', args: { filePath: outputs.length === 0 ? 'bulk.txt' : 'latest.txt' } }];
        } else if (ref && outputs.length === 2 && names.includes(`${MCP_TOOL_PREFIX}${McpToolName.Recall}`)) {
          calls = [operation(McpToolName.Recall, { messageId: ref[1], partId: ref[2], limit: 16 })];
        } else if (ref && outputs.length === 3 && offset) {
          calls = [
            operation(McpToolName.Recall, { messageId: ref[1], partId: ref[2], offset: Number(offset), limit: 1024 }),
          ];
        } else {
          const evidence = outputs.join('\n');
          const first = /FIRST=([a-f0-9-]+)/.exec(evidence)?.[1];
          const second = /SECOND=([a-f0-9-]+)/.exec(evidence)?.[1];
          calls = [submit([first, second].join(' / '))];
        }
      } else if (hasProbe(CONTEXT_PROBE) || hasProbe(DISABLE_PROBE)) {
        contextRequests.push(messages);
        const reads = messages.filter((m) => m.role === 'tool').length;
        if (reads < 2) calls = [{ name: 'read', args: { filePath: reads === 0 ? 'bulk.txt' : 'latest.txt' } }];
        else if (reads === 2 && hasProbe(DISABLE_PROBE)) {
          await t.call(updateSettingsOp, { 'ai.contextEngine': false });
          calls = [{ name: 'read', args: { filePath: 'README.md' } }];
        } else calls = [operation(McpToolName.SubmitResult, { summary: 'Read both files', notes: 'completed' })];
      } else if (hasProbe(PROBE_CHILD)) {
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
      } else if (prompt.startsWith(DESIGN_MCP_PROBE)) {
        accountingToolMenus.push(names);
        const start = prompt.includes('start');
        const name = start ? 'aicoding_story_start' : 'aicoding_story_complete';
        if (names.includes(name))
          calls = [{ name, args: start ? { ipmpSystemCode: 'fixture', storyCode: 'sample' } : {} }];
      } else if (prompt.includes('本轮分析数据：') && hasProbe(DESIGN_MCP_PROBE)) {
        const json = prompt.split('本轮分析数据：\n')[1]?.split('\n')[0] ?? '';
        const context = JSON.parse(json) as { sections: { id: string }[] };
        const sectionId = context.sections[0]?.id;
        if (names.includes(MCP_TOOL_PREFIX + McpToolName.SubmitDesignOutline)) {
          calls = [
            operation(McpToolName.SubmitDesignOutline, {
              sections: [{ kind: 'module', title: '样例', scopePaths: ['README.md'] }],
            }),
          ];
        } else if (names.includes(MCP_TOOL_PREFIX + McpToolName.SubmitDesignReview)) {
          calls = [
            operation(McpToolName.SubmitDesignReview, { findings: [{ sectionId, reviewState: 'passed', notes: [] }] }),
          ];
        } else {
          calls = [
            operation(McpToolName.SubmitDesignSection, {
              sectionId,
              summary: '样例',
              blocks: [{ type: 'markdown', markdown: '样例' }],
              diagrams: [],
              files: [],
            }),
          ];
        }
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
          ? { role: 'assistant', content: replyText }
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
    models: { [MODEL]: { name: 'Scripted', tool_call: true, variants: { deep: { reasoningEffort: 'high' } } } },
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
  t = await createTestApp({
    realOpencode: true,
    env: {
      ...process.env,
      OPENCODE_CONFIG: configFile,
      OPENCODE_TEST_HOME: configDir,
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      ...Object.fromEntries(
        ['DATA', 'CONFIG', 'STATE', 'CACHE'].map((key) => [`XDG_${key}_HOME`, join(configDir, key)]),
      ),
    },
  });
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

it('知识研究的真实 Bash 询问按 Ask、Assisted、Full 独立审批', async () => {
  const { project } = await addProject(t, { files: { 'README.md': 'checksum fixture' } });
  await t.call(updateSettingsOp, { 'ai.defaultModel': `${PROVIDER}/${MODEL}`, 'scheduler.maxConcurrentAttempts': 3 });
  const nativeRequests: string[] = [];
  const unsubscribe = t.app.services.opencode.subscribe((event) => {
    if (event.type === OpencodeEventType.PermissionAsked && event.permission === 'bash')
      nativeRequests.push(event.permissionId);
  });
  try {
    for (const permissionMode of [PermissionMode.Ask, PermissionMode.Assisted, PermissionMode.Full]) {
      const finished = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt }) => attempt.kind === AttemptKind.Research && attempt.status === AttemptStatus.Succeeded,
      );
      const manual = permissionMode === PermissionMode.Ask ? inboxOpens(t, InboxKind.Permission) : undefined;
      const { body } = await t.call(askKnowledgeOp, {
        projectId: project.id,
        question: RESEARCH_PERMISSION_PROBE,
        sources: { code: true, docs: true, web: false, database: false },
        permissionMode,
      });
      if (manual) {
        const { item } = await manual;
        expect(item.title).toContain('cksum');
        await t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Once } });
      }
      const { attempt } = await finished;
      const current = (await t.call(getKnowledgeOp, { id: body.id })).body;
      expect(current).toMatchObject({ permissionMode, turns: [{ answer: 'Repository checked.' }] });
      const transcript = t.app.services.attempts.transcript(attempt.id, 0);
      const review = JSON.stringify(transcript);
      if (permissionMode === PermissionMode.Assisted) expect(review).toContain('Verified repository checksum');
      else expect(review).not.toContain('Verified repository checksum');
    }
    expect(nativeRequests).toHaveLength(3);
  } finally {
    unsubscribe();
  }
});

it('真实设计会话自动通过搜索管道的 Bash 请求，用比对输出提交大纲', async () => {
  const { project } = await addProject(t, {
    files: { 'README.md': 'ITEM_KEEP\nITEM_SHARED\n', 'known.txt': 'ITEM_SHARED\n' },
  });
  await t.call(updateSettingsOp, { 'ai.defaultModel': `${PROVIDER}/${MODEL}` });
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, permissionMode: PermissionMode.Full });
  const patterns: string[] = [];
  const unsubscribe = t.app.services.opencode.subscribe((event) => {
    if (event.type === OpencodeEventType.PermissionAsked && event.permission === 'bash')
      patterns.push(...event.patterns);
  });
  try {
    const finished = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt }) => attempt.kind === AttemptKind.DesignOutline && attempt.status === AttemptStatus.Succeeded,
    );
    await t.call(reviseDesignOutlineOp, { id: design.id, instruction: DESIGN_SEARCH_PROBE });
    await finished;
    expect(patterns).toContain('comm -23 - known.txt');
    const { body } = await t.call(getDesignOp, { id: design.id });
    expect(body.sections.map((s) => s.title)).toEqual(['ITEM_KEEP']);
  } finally {
    unsubscribe();
  }
});

it('自定义档位进入真实模型请求，下一轮模型默认及无效档位均省略强度', async () => {
  const oc = t.app.services.opencode;
  const directory = repo.path;
  const agent = OPENCODE_AGENT_NAME[RoleBaseAgent.Reviewer];
  const sessionId = await oc.createSession({ directory, agent, permission: [], title: 'Variant probe' });
  const model = { providerId: PROVIDER, modelId: MODEL };
  for (const variant of ['deep', null, 'missing']) {
    await oc.promptDocument({
      directory,
      sessionId,
      agent,
      model,
      efforts: [{ model: PROVIDER + '/' + MODEL, variant }],
      text: EFFORT_PROBE + String(variant),
    });
  }
  expect(sentEfforts).toEqual(['high', undefined, undefined]);
});

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

it.each([
  ['充足预算', { context: 131072 }],
  ['首步超限', { context: 2048 }],
  ['运行中停用', { context: 27000 }],
  ['新任务关闭', { context: 131072 }],
  ['未知上下文上限', { context: 0 }],
  ['零输入上限', { context: 131072, input: 0 }],
] as const)(
  'M1 真实模型请求（%s）',
  async (scenario, limits) => {
    const warning = scenario === '首步超限';
    const disable = scenario === '运行中停用';
    const native = scenario === '新任务关闭';
    contextRequests.length = 0;
    foregroundRequests = 0;
    await t.call(updateSettingsOp, { 'ai.contextEngine': !native, 'ai.defaultModel': null, 'node.maxAttempts': 3 });
    const spec = providerFor(model);
    const projectModel = `${PROJECT_PROVIDER}/${MODEL}`;
    const { project } = await addProject(t, {
      checkCommand: null,
      files: {
        'bulk.txt': Array(200).fill('RAW_CONTEXT_EVIDENCE '.repeat(10)).join('\n'),
        'latest.txt': Array(200).fill('LATEST_CONTEXT_EVIDENCE '.repeat(9)).join('\n'),
        'opencode.json': JSON.stringify({
          model: projectModel,
          compaction: { auto: true, prune: true },
          provider: {
            [PROJECT_PROVIDER]: {
              ...spec,
              models: {
                [MODEL]: {
                  ...spec.models[MODEL],
                  limit: { ...limits, output: 1024 },
                },
              },
            },
          },
        }),
      },
    });
    const done = waitForEvent(
      t.app.events,
      ServerEventType.NodeUpdated,
      ({ node }) =>
        node.key === 'locate' && (node.status === NodeStatus.Failed || node.status === NodeStatus.AwaitingAcceptance),
      30000,
    );
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      requirement: disable ? DISABLE_PROBE : CONTEXT_PROBE,
      checkpoints: { accept_each_node: true },
    });
    try {
      const { node } = await done;
      expect(node.status).toBe(disable ? NodeStatus.Failed : NodeStatus.AwaitingAcceptance);
      const detail = (await t.call(getNodeOp, { id: task.id, nodeId: node.id })).body;
      expect(detail.attempts).toHaveLength(1);
      if (scenario === '未知上下文上限' || scenario === '零输入上限') {
        expect(t.logs).toContainEqual(
          expect.objectContaining({
            msg: 'context budget',
            attemptId: detail.attempts[0]?.id,
            blocked: false,
            limit: scenario === '未知上下文上限' ? null : 131072 - 1024,
          }),
        );
      }
      const worktree = t.app.services.worktrees.findByTask(task.id);
      if (!worktree) throw new Error('Missing worktree');
      const sdk = t.app.services.runtime.sdk();
      expect(
        (await sdk.config.get({ directory: worktree.path }, { throwOnError: true })).data.compaction,
      ).toMatchObject({ auto: native, prune: native });
      if (disable) {
        expect(detail.attempts[0]).toMatchObject({
          nudges: 0,
          error: {
            code: ErrorCode.AttemptContextBudget,
            message: 'Request exceeded the model context budget before sending',
          },
        });
        expect(detail.retryFeedback).toContain('Reduce the input before retrying');
        expect(foregroundRequests).toBe(3);
      }
      if (warning)
        expect(t.logs).toContainEqual(
          expect.objectContaining({ attemptId: detail.attempts[0]?.id, blocked: false, overBudgetWarning: true }),
        );
      {
        const last = contextRequests.at(-1) ?? [];
        expect(last.filter((m) => m.role === 'tool').map(textOf)).toEqual([
          warning || disable
            ? expect.stringMatching(/AW read messageId=.*partId=.*bulk.txt/)
            : expect.stringContaining('RAW_CONTEXT_EVIDENCE'),
          expect.stringContaining('LATEST_CONTEXT_EVIDENCE'),
        ]);
        expect(last.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(
          last.flatMap((m) => m.tool_calls?.map((call) => call.id) ?? []),
        );
        expect(contextRequests).toHaveLength(3);
        const owner = detail.attempts[0];
        if (!owner) throw new Error('Missing attempt');
        const sessionID = t.app.services.attempts.get(owner.id).opencodeSessionId;
        if (!sessionID) throw new Error('Missing session');
        const history = await sdk.session.messages({ sessionID, directory: worktree.path }, { throwOnError: true });
        expect(
          history.data.some((m) =>
            m.parts.some(
              (p) =>
                p.type === 'tool' &&
                p.tool === 'read' &&
                p.state.status === 'completed' &&
                p.state.output.includes('RAW_CONTEXT_EVIDENCE'),
            ),
          ),
        ).toBe(true);
        expect(
          t.app.services.attempts
            .transcript(owner.id, 0)
            .entries.some((e) => e.kind === 'tool_result' && e.data.output?.includes('RAW_CONTEXT_EVIDENCE')),
        ).toBe(true);
      }
    } finally {
      await t.call(cancelTaskOp, { id: task.id });
      await t.call(updateSettingsOp, { 'ai.contextEngine': false });
    }
  },
  45000,
);

it.each([
  ['原文', 131072],
  ['分页召回', 40000],
] as const)(
  'M2 设计会话使用跨批次的两份证据提交章节（%s）',
  async (source, context) => {
    const first = randomUUID();
    const second = randomUUID();
    const spec = providerFor(model);
    const projectModel = `${PROJECT_PROVIDER}/${MODEL}`;
    const { project } = await addProject(t, {
      files: {
        'bulk.txt': `FIRST=${first}\n${Array(200).fill('large file line '.repeat(12)).join('\n')}`,
        'latest.txt': `SECOND=${second}\n${Array(200).fill('latest file line '.repeat(12)).join('\n')}`,
        'opencode.json': JSON.stringify({
          model: projectModel,
          provider: {
            [PROJECT_PROVIDER]: {
              ...spec,
              models: { [MODEL]: { ...spec.models[MODEL], limit: { context, output: 1024 } } },
            },
          },
        }),
      },
    });
    await t.call(updateSettingsOp, { 'ai.contextEngine': true, 'ai.defaultModel': null });
    async function run(title: string) {
      contextRequests.length = 0;
      const { body: design } = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: false });
      const edited = await t.call(updateDesignOutlineOp, {
        id: design.id,
        sections: [{ kind: DesignSectionKind.Module, title, scopePaths: ['bulk.txt', 'latest.txt'], selected: true }],
      });
      expect(edited.status).toBe(200);
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt }) => attempt.kind === AttemptKind.DesignGenerate && attempt.endedAt !== null,
        30000,
      );
      const [started, terminal] = await Promise.all([
        t.call(generateDesignOp, { id: design.id, model: projectModel }),
        ended,
      ]);
      expect(started.status).toBe(200);
      expect(terminal.attempt.error).toBeNull();
      return (await t.call(getDesignOp, { id: design.id })).body.sections[0]?.summary;
    }
    try {
      const result = await run(RECALL_PROBE);
      expect(result).toBe(`${first} / ${second}`);
      const outputs = contextRequests[2]?.filter((m) => m.role === 'tool').map(textOf);
      expect(outputs?.[1]).toContain(second);
      if (source === '原文') {
        expect(outputs?.[0]).toContain(first);
        expect(contextRequests).toHaveLength(3);
      } else {
        const ref = coordinates.exec(outputs?.[0] ?? '');
        if (!ref) throw new Error('Missing folded source coordinates');
        expect(outputs?.[0]).not.toContain(first);
        expect(contextRequests).toHaveLength(5);
        const foreign = await run(`${FOREIGN_PROBE} ${ref[0]}`);
        expect(foreign).toContain(ErrorCode.NotFound);
        expect(foreign).toContain('current session');
        expect(foreign).not.toContain(first);
      }
    } finally {
      await t.call(updateSettingsOp, { 'ai.contextEngine': false });
    }
  },
  90_000,
);

it('M3 真实溢出压缩恢复后，主请求在途时生成无工具摘要，同一 Session 下一请求带新证据并完成', async () => {
  contextRequests.length = 0;
  const spec = providerFor(model);
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      'bulk.txt': Array.from({ length: 90 }, (_, i) => `EARLY_FINDING ${i} ${'sample '.repeat(65)}`).join('\n'),
      'latest.txt': 'Latest batch before worker '.repeat(100),
      'new.txt': 'EVIDENCE_AFTER_FREEZE',
      // 测试屏障：read 已取得新证据，此时允许 Worker 回答，再让主循环进入下一次真实 transform。
      '.opencode/plugins/read-barrier.js': `export const barrier = async () => ({
        'tool.execute.after': async ({tool}, result) => {
          if (tool === 'read' && result.output.includes('EVIDENCE_AFTER_FREEZE'))
            await fetch('http://127.0.0.1:${(model.address() as AddressInfo).port}/summary-read-produced');
        }
      })`,
      'opencode.json': JSON.stringify({
        model: `${PROJECT_PROVIDER}/${MODEL}`,
        compaction: { tail_turns: 0 },
        provider: {
          [PROJECT_PROVIDER]: {
            ...spec,
            models: { [MODEL]: { ...spec.models[MODEL], limit: { context: 30000, output: 1024 } } },
          },
        },
      }),
    },
  });
  await t.call(updateSettingsOp, {
    'ai.contextEngine': true,
    'ai.defaultModel': null,
    'scheduler.maxConcurrentAttempts': 3,
  });
  const unsubscribe = t.app.services.opencode.subscribe((e) => {
    if (
      e.type === OpencodeEventType.Deleted &&
      t.logs.some(
        (l) => l.msg === 'context summary usage' && 'workerSessionId' in l && l.workerSessionId === e.sessionId,
      )
    )
      summarySaved.resolve();
  });
  const done = waitForEvent(
    t.app.events,
    ServerEventType.NodeUpdated,
    ({ node }) =>
      node.key === 'locate' && [NodeStatus.AwaitingAcceptance, NodeStatus.Failed].some((s) => s === node.status),
    25000,
  );
  const task = await createTask(t, {
    projectId: project.id,
    workflow: 'bugfix',
    requirement: SUMMARY_PROBE,
    checkpoints: { accept_each_node: true },
  });
  try {
    const { node } = await done;
    const detail = (await t.call(getNodeOp, { id: task.id, nodeId: node.id })).body;
    expect(detail.result?.summary, JSON.stringify(t.logs.filter((l) => String(l.msg).startsWith('context ')))).toBe(
      'Finished with summary',
    );
    expect(detail.result?.notes).toBe('Used old and new evidence alongside the summary');
    expect(detail.attempts).toHaveLength(1);
    expect(contextRequests).toHaveLength(4);
    expect(workerTools).toEqual([[]]);
    const before = (contextRequests[2] ?? []).map(textOf).join('');
    const after = (contextRequests[3] ?? []).map(textOf).join('');
    expect(before).toContain('EARLY_FINDING');
    expect(after).toContain('Verified the early finding');
    expect(after).toContain('Latest batch before worker');
    expect(after).not.toContain('EARLY_FINDING');
    expect(after.length).toBeLessThan(before.length * 0.7);
    const owner = detail.attempts[0];
    if (!owner) throw new Error('Missing attempt');
    const attempt = t.app.services.attempts.get(owner.id);
    const view = (await t.call(getAttemptContextOp, { id: owner.id })).body;
    expect(attempt.nudges).toBe(0);
    expect(view.compactionRequests).toBe(1);
    expect(view.compactions).toBe(1);
    expect(view.messages.some((m) => m.status === 'archived' && !m.sent && m.projectedTokens === 0)).toBe(true);
    expect(view.budget?.calibrated).toBe(true);
    expect(view.messages.some((m) => m.status === 'folded')).toBe(false);
    const recovered = t.logs.findIndex((l) => l.msg === 'context overflow recovery continued');
    expect(recovered).toBeGreaterThan(0);
    const budgets = t.logs
      .slice(recovered + 1)
      .filter((l) => l.msg === 'context budget' && 'sessionId' in l && l.sessionId === attempt.opencodeSessionId);
    expect(budgets[0]).toMatchObject({ calibrated: false, bytesPerToken: 3 });
    expect(budgets.at(-1)).toMatchObject({ calibrated: true });
    const storage = new DatabaseSync(join(t.dataDir, 'app.db'), { readOnly: true });
    try {
      expect(
        storage.prepare('SELECT summary_text FROM context_summaries WHERE session_id=?').all(attempt.opencodeSessionId),
      ).toEqual([{ summary_text: 'Verified the early finding in bulk.txt.' }]);
    } finally {
      storage.close();
    }
    expect(
      t.logs.filter(
        (l) =>
          l.msg === 'mcp tool called' &&
          'tool' in l &&
          l.tool === McpToolName.SubmitResult &&
          'attemptId' in l &&
          l.attemptId === attempt.id,
      ),
    ).toHaveLength(1);
    expect(t.logs).toContainEqual(
      expect.objectContaining({
        msg: 'context summary usage',
        sessionId: attempt.opencodeSessionId,
        tokens: expect.objectContaining({ output: 1 }),
      }),
    );
  } finally {
    workerStarted.resolve();
    newReadProduced.resolve();
    summarySaved.resolve();
    unsubscribe();
    await t.call(cancelTaskOp, { id: task.id });
    await t.call(updateSettingsOp, { 'ai.contextEngine': false });
  }
}, 40000);

it('@opencode 设计的规划、生成、复审和重写分别通过用户的 MCP 实际开始与结束一次', async () => {
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      'opencode.json': JSON.stringify({
        mcp: {
          aicoding: {
            type: 'local',
            command: [
              process.execPath,
              fileURLToPath(new URL('../../../test/fixtures/design-accounting-mcp.mjs', import.meta.url)),
            ],
          },
        },
        permission: { aicoding_blocked: 'deny' },
        command: { aicoding: { template: DESIGN_MCP_PROBE + ' $ARGUMENTS' } },
      }),
    },
  });
  await t.call(updateSettingsOp, {
    'ai.defaultModel': PROVIDER + '/' + MODEL,
    'ai.sessionStartCommand': '/aicoding start fixture sample',
    'ai.sessionEndCommand': '/aicoding complete',
  });
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: true });
  const completed = (kind: AttemptKind) =>
    waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt }) => attempt.kind === kind && attempt.endedAt !== null,
      45_000,
    );
  try {
    const review = completed(AttemptKind.DesignReview);
    const [, { attempt }] = await Promise.all([
      t.call(reviseDesignOutlineOp, { id: design.id, generateAfterPlanning: true }),
      review,
    ]);
    await t.app.services.attempts.waitForSessionRelease(attempt.id);
    const { body: ready } = await t.call(getDesignOp, { id: design.id });
    const section = ready.sections[0];
    if (!section) throw new Error('Missing planned section');
    const revision = completed(AttemptKind.DesignRevise);
    const [, revised] = await Promise.all([
      t.call(reviseDesignSectionOp, { id: design.id, sectionId: section.id, instruction: '核对' }),
      revision,
    ]);
    await t.app.services.attempts.waitForSessionRelease(revised.attempt.id);
    const { body: result } = await t.call(getDesignOp, { id: design.id });
    expect(result.runs.map((r) => r.kind)).toEqual(['outline', 'generate', 'review', 'revise']);
    const sessionIds = new Set<string>();
    let receipt = 0;
    for (const run of result.runs) {
      expect(run.attempt.status).toBe(AttemptStatus.Succeeded);
      const sessionId = t.app.services.attempts.get(run.attempt.id).opencodeSessionId;
      if (!sessionId) throw new Error('Missing design session');
      sessionIds.add(sessionId);
      const messages = await t.app.services.opencode.sessionMessages({ sessionId, directory: project.repoPath });
      const outputs = messages.flatMap((m) =>
        m.parts.flatMap((p) =>
          p.type === 'tool' && p.tool.startsWith('aicoding_') && p.state.status === 'completed'
            ? [JSON.parse(p.state.output)]
            : [],
        ),
      );
      expect(outputs).toEqual([
        { name: 'story_start', ipmpSystemCode: 'fixture', storyCode: 'sample', receipt: ++receipt },
        { name: 'story_complete', receipt: ++receipt },
      ]);
    }
    expect(sessionIds.size).toBe(4);
    expect(accountingToolMenus).toHaveLength(8);
    for (const names of accountingToolMenus) {
      expect(names).toContain('aicoding_lookup');
      for (const hidden of [
        'aicoding_blocked',
        'apply_patch',
        'edit',
        'write',
        'task',
        MCP_TOOL_PREFIX + McpToolName.SubmitResult,
      ])
        expect(names).not.toContain(hidden);
    }

    // 普通开发节点在自己的工作树使用同一项目 MCP 配置。
    const done = nodeReaches(t, 'build_page', NodeStatus.Done, 45_000);
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'frontend',
      requirement: PROBE_SESSION_COMMAND,
    });
    try {
      const { node } = await done;
      await t.app.services.attempts.waitForEndCommands(task.id);
      const { body: detail } = await t.call(getNodeOp, { id: task.id, nodeId: node.id });
      const summary = detail.attempts[0];
      if (!summary) throw new Error('Missing execution attempt');
      const entries = t.app.services.attempts.transcript(summary.id, 0).entries;
      expect(
        entries.flatMap((e) =>
          e.kind === 'tool_result' && e.data.tool.startsWith('aicoding_') && e.data.output
            ? [JSON.parse(e.data.output).name]
            : [],
        ),
      ).toEqual(['story_start', 'story_complete']);
      for (const names of accountingToolMenus.slice(8)) {
        expect(names).toContain('aicoding_lookup');
        expect(names).not.toContain('aicoding_blocked');
      }
    } finally {
      await t.call(cancelTaskOp, { id: task.id });
    }
  } finally {
    await t.call(updateSettingsOp, { 'ai.sessionStartCommand': null, 'ai.sessionEndCommand': null });
  }
}, 90_000);
