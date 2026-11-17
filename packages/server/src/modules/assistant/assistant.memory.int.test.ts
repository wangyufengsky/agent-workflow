import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  type AssistantPageRef,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createAssistantMemoryOp,
  createConversationOp,
  deleteAssistantMemoryOp,
  deleteConversationOp,
  deleteProjectOp,
  ErrorCode,
  getConversationOp,
  listAssistantMemoriesOp,
  listConfirmationsOp,
  MCP_SESSION_ARG,
  sendAssistantMessageOp,
  updateAssistantMemoryOp,
} from '@aw/shared';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';
import { openDatabase } from '../../core/db/database.ts';

let app: TestApp | undefined;
afterEach(() => app?.close());

const HOME: AssistantPageRef = { page: 'home', params: {} };
const projectPage = (projectId: string): AssistantPageRef => ({ page: 'project', params: { projectId } });

async function say(t: TestApp, id: string, text: string, context = HOME) {
  expect((await t.call(sendAssistantMessageOp, { id, text, context })).status).toBe(200);
  await t.fake.settled();
  const prompt = t.fake.prompts.at(-1);
  if (prompt === undefined) throw new Error('Expected assistant prompt');
  return prompt;
}

it('项目提议需要逐条确认，保存范围取自会话而非当前页面，只有应用助手可以提议', async () => {
  app = await createTestApp();
  const t = app;
  const { project: a } = await addProject(t);
  const { project: b } = await addProject(t);
  const source = (await t.call(createConversationOp, { projectId: a.id })).body;
  const prompt = await say(t, source.id, '记住，客户验收文档用中文', projectPage(b.id));
  expect(prompt.system).toContain(`Session project: Project "${a.name}" (project id ${a.id},`);
  expect(prompt.system).toContain(`The user is on: the page of project "${b.name}"`);
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  const execution = await connectMcp(t.mcpUrl, t.app.mcpToken);
  const args = { [MCP_SESSION_ARG]: prompt.sessionId, scope: 'project', content: '客户验收文档用中文' };
  try {
    expect((await execution.listTools()).tools.map((tool) => tool.name)).not.toContain('memory_create');
    const workflow = await workflowId(t, 'bugfix');
    const taskArgs = {
      [MCP_SESSION_ARG]: prompt.sessionId,
      workflowId: workflow,
      requirement: '文档封面更新',
      start: false,
    };
    const refused = await callTool(mcp, 'tasks_create', { ...taskArgs, projectId: b.id });
    expect(refused.body).toMatchObject({ code: ErrorCode.ValidationFailed });
    expect((await callTool(mcp, 'memory_create', { ...args, projectId: b.id })).body).toMatchObject({
      code: ErrorCode.ValidationFailed,
    });
    expect((await callTool(mcp, 'memory_create', args)).body).toMatchObject({ status: 'needs_confirmation' });
    const [draft] = (await t.call(listConfirmationsOp, { id: source.id })).body.items;
    if (draft === undefined) throw new Error('Expected proposal');
    expect(draft).toMatchObject({ risk: 'critical', input: { projectId: a.id, content: args.content } });
    expect((await t.call(listAssistantMemoriesOp, {})).body.items).toEqual([]);
    expect((await t.call(confirmAssistantCallOp, { id: draft.id, alwaysAllow: true })).status).toBe(400);
    expect((await t.call(cancelAssistantCallOp, { id: draft.id })).body.status).toBe('cancelled');
    await t.fake.settled();
    expect((await t.call(listAssistantMemoriesOp, {})).body.items).toEqual([]);

    await callTool(mcp, 'memory_create', args);
    const next = (await t.call(listConfirmationsOp, { id: source.id })).body.items.find(
      (card) => card.status === 'pending',
    );
    if (next === undefined) throw new Error('Expected second proposal');
    const confirmed = await t.call(confirmAssistantCallOp, { id: next.id });
    expect(confirmed.body.result).toMatchObject({
      ok: true,
      output: { projectId: a.id, sourceConversationId: source.id },
    });
    await t.fake.settled();
    expect((await t.call(confirmAssistantCallOp, { id: next.id })).status).toBe(409);
    expect((await t.call(listAssistantMemoriesOp, {})).body.items).toEqual([
      expect.objectContaining({ projectId: a.id, content: args.content, sourceConversationId: source.id }),
    ]);

    const general = (await t.call(createConversationOp, {})).body;
    const generalPrompt = await say(t, general.id, '帮我记住这个项目的约定', projectPage(a.id));
    expect(
      (await callTool(mcp, 'memory_create', { ...args, [MCP_SESSION_ARG]: generalPrompt.sessionId })).body,
    ).toMatchObject({ code: ErrorCode.ValidationFailed });
    expect((await t.call(listConfirmationsOp, { id: general.id })).body.items).toEqual([]);

    expect((await t.call(deleteConversationOp, { id: source.id })).status).toBe(204);
    expect((await t.call(listAssistantMemoriesOp, {})).body.items).toEqual([
      expect.objectContaining({ sourceConversationId: null, content: args.content }),
    ]);
  } finally {
    await Promise.all([mcp.close(), execution.close()]);
  }
});

it('重启后新对话按项目召回，通用对话只读个人记忆，修改和删除影响下一次召回', async () => {
  app = await createTestApp();
  const { project: a } = await addProject(app);
  const { project: b } = await addProject(app);
  const personal = '进度汇报先写结论';
  const first = '合同交付使用靛蓝模板';
  const revised = '合同交付使用青色模板';
  const other = '进度报告使用橙色模板';
  await app.call(createAssistantMemoryOp, { content: personal, projectId: null });
  const { body: memory } = await app.call(createAssistantMemoryOp, { content: first, projectId: a.id });
  await app.call(createAssistantMemoryOp, { content: other, projectId: b.id });
  const { dataDir } = app;
  await app.close();
  app = await createTestApp({ dataDir });

  const aChat = (await app.call(createConversationOp, { projectId: a.id })).body;
  const bChat = (await app.call(createConversationOp, { projectId: b.id })).body;
  const general = (await app.call(createConversationOp, {})).body;
  expect(aChat.projectId).toBe(a.id);
  const aFirst = await say(app, aChat.id, '这次交付用什么模板？', projectPage(b.id));
  expect(aFirst.system).toContain(JSON.stringify({ personal: [personal], project: [first] }));
  const bFirst = await say(app, bChat.id, '这次交付用什么模板？', projectPage(a.id));
  expect(bFirst.system).toContain(JSON.stringify({ personal: [personal], project: [other] }));
  const generalFirst = await say(app, general.id, '这次交付用什么模板？', projectPage(a.id));
  expect(generalFirst.system).toContain(JSON.stringify({ personal: [personal], project: [] }));

  expect((await app.call(updateAssistantMemoryOp, { id: memory.id, content: revised })).body.content).toBe(revised);
  const afterEdit = await say(app, aChat.id, '你记得什么？');
  expect(afterEdit.system).toContain(JSON.stringify({ personal: [personal], project: [revised] }));
  expect((await app.call(deleteAssistantMemoryOp, { id: memory.id })).status).toBe(204);
  const afterDelete = await say(app, aChat.id, '再讲一下');
  expect(afterDelete.system).toContain(JSON.stringify({ personal: [personal], project: [] }));

  expect((await app.call(deleteProjectOp, { id: b.id })).status).toBe(204);
  expect((await app.call(getConversationOp, { id: bChat.id })).body.projectId).toBe(b.id);
  expect((await app.call(listAssistantMemoriesOp, {})).body.items.map((item) => item.content)).toEqual([personal]);
  const deleted = await say(app, bChat.id, '这个项目呢？', projectPage(a.id));
  expect(deleted.system).toContain('Deleted project (project id');
  expect((await app.call(createConversationOp, { projectId: b.id })).status).toBe(404);
});

it('从上一版迁移时，既有助手对话仍能读取并保留为通用对话', async () => {
  const oldMigrations = await mkdtemp(join(tmpdir(), 'aw-before-memory-'));
  await cp(fileURLToPath(new URL('../../../migrations/', import.meta.url)), oldMigrations, { recursive: true });
  const journalFile = join(oldMigrations, 'meta', '_journal.json');
  const journal: { entries: { idx: number }[] } = JSON.parse(await readFile(journalFile, 'utf8'));
  journal.entries = journal.entries.filter(({ idx }) => idx < 43);
  await writeFile(journalFile, JSON.stringify(journal));

  const dataDir = await mkdtemp(join(tmpdir(), 'aw-memory-upgrade-'));
  const file = join(dataDir, 'app.db');
  openDatabase(file, oldMigrations).close();
  // 模拟启用记忆之前的通用对话。
  const raw = new DatabaseSync(file);
  try {
    raw
      .prepare(
        'INSERT INTO assistant_conversations (id, title, isolated, created_at, updated_at) VALUES (?, ?, 1, 1, 1)',
      )
      .run('old-conversation', '升级前的对话');
  } finally {
    raw.close();
  }
  app = await createTestApp({ dataDir });
  expect((await app.call(getConversationOp, { id: 'old-conversation' })).body).toMatchObject({
    title: '升级前的对话',
    projectId: null,
  });
  expect((await say(app, 'old-conversation', '继续讨论')).system).toContain('General conversation (no bound project).');
});
