import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  abortAssistantOp,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  createTaskOp,
  DeliveryStrategy,
  deleteConversationOp,
  deliverTaskOp,
  ErrorCode,
  getTaskOp,
  listConfirmationsOp,
  listTasksOp,
  MCP_SESSION_ARG,
  OPENCODE_ASSISTANT_AGENT,
  ServerEventType,
  sendAssistantMessageOp,
  startTaskOp,
  type TaskDetailDTO,
  TaskStatus,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import type { TestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
let repo: TestRepo;
let conversationId: string;
let sessionId: string;
let input: { projectId: string; workflowId: string; requirement: string; start: false };
const HOME = { page: 'home', params: {} } as const;

beforeEach(async () => {
  t = await createTestApp();
  const added = await addProject(t, { checkCommand: null });
  const { project } = added;
  repo = added.repo;
  input = { projectId: project.id, workflowId: await workflowId(t, 'bugfix'), requirement: '修复问候语', start: false };
  conversationId = (await t.call(createConversationOp, {})).body.id;
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '帮我修复', context: HOME });
  await t.fake.settled();
  const session = t.fake.sessions.find((item) => item.agent === OPENCODE_ASSISTANT_AGENT);
  if (session === undefined) throw new Error('Missing assistant session');
  sessionId = session.id;
});
afterEach(async () => {
  await t.close();
});

function withDatabase<T>(work: (db: DatabaseSync) => T): T {
  const raw = new DatabaseSync(join(t.dataDir, 'app.db'));
  try {
    return work(raw);
  } finally {
    raw.close();
  }
}

async function assistantTask(alwaysAllow: boolean): Promise<TaskDetailDTO> {
  if (alwaysAllow) await t.call(updateSettingsOp, { 'assistant.alwaysAllow': [createTaskOp.id] });
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  try {
    const result = await callTool(mcp, 'tasks_create', { ...input, [MCP_SESSION_ARG]: sessionId });
    expect(result.isError).toBe(false);
    if (alwaysAllow) return createTaskOp.output.parse(result.body);
    expect((await t.call(listTasksOp, {})).body.items).toEqual([]);
    const confirmed = await t.call(confirmAssistantCallOp, { id: String(result.body.confirmation_id) });
    expect(confirmed.status).toBe(200);
    if (confirmed.body.result?.ok !== true) throw new Error('Task creation was not confirmed');
    await t.fake.settled();
    return createTaskOp.output.parse(confirmed.body.result.output);
  } finally {
    await mcp.close();
  }
}

function notifications() {
  return t.fake.prompts.filter((prompt) => prompt.sessionId === sessionId && prompt.text.includes('Task snapshot:'));
}

async function runToReview(task: TaskDetailDTO, settle = true): Promise<void> {
  const directory = `/${task.key}`;
  t.fake.enqueue(script().callTool('submit_result', { summary: '找到问候语根因' }), { title: '· 定位根因', directory });
  t.fake.enqueue(script().edit('greeting.txt', 'hello\n').callTool('submit_result', { summary: '修好了问候语' }), {
    title: '· 修复',
    directory,
  });
  t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: '检查通过' }), {
    agent: 'aw-reviewer',
    directory,
  });
  const reviewed = waitForEvent(
    t.app.events,
    ServerEventType.TaskUpdated,
    (item) => item.id === task.id && item.status === TaskStatus.Review,
  );
  expect((await t.call(startTaskOp, { id: task.id })).status).toBe(200);
  await reviewed;
  if (settle) await t.fake.settled();
}

it.each([false, true])(
  '确认/总是允许（%s）在首次任务事件前持久化归属，待验收与真实交付结果只回到原对话',
  async (alwaysAllow) => {
    const other = (await t.call(createConversationOp, {})).body.id;
    await t.call(sendAssistantMessageOp, { id: other, text: '另一段对话', context: HOME });
    await t.fake.settled();
    const observed: unknown[] = [];
    const unsubscribe = t.app.events.subscribe((event) => {
      if (event.type === ServerEventType.TaskUpdated && event.data.status === TaskStatus.Draft) {
        observed.push(
          withDatabase((db) =>
            db.prepare('SELECT conversation_id FROM assistant_task_followups WHERE task_id = ?').get(event.data.id),
          ),
        );
      }
    });
    const task = await assistantTask(alwaysAllow);
    unsubscribe();
    expect(observed).toEqual([{ conversation_id: conversationId }]);
    await runToReview(task);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]?.text).toContain('"status": "review"');
    expect(notifications()[0]?.text).toContain('修好了问候语');
    expect(notifications()[0]?.text).toContain('"passed": true');
    expect(notifications()[0]?.text).toContain(`/tasks/${task.id}`);
    const delivered = await t.call(deliverTaskOp, { id: task.id, strategy: DeliveryStrategy.Squash });
    expect(delivered.status).toBe(200);
    await t.fake.settled();
    expect(notifications()).toHaveLength(2);
    expect(notifications()[1]?.text).toContain('"status": "completed"');
    expect(notifications()[1]?.text).toContain(delivered.body.lastDelivery?.commitSha);
    expect(
      t.fake.prompts.filter((p) => p.text.includes('Task snapshot:')).every((p) => p.sessionId === sessionId),
    ).toBe(true);
    // 重复状态事件没有新 task_events 行，不重复通知。
    t.app.events.publish({ type: ServerEventType.TaskUpdated, data: delivered.body });
    await t.fake.settled();
    expect(notifications()).toHaveLength(2);
  },
);

it('助手忙时排队，断线和重启后自动送达；未消费的真实事件也会补扫且不再重复', async () => {
  const task = await assistantTask(true);
  t.fake.enqueue(script().hang(), { agent: OPENCODE_ASSISTANT_AGENT });
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '等一下', context: HOME });
  await runToReview(task, false);
  expect(notifications()).toEqual([]);
  expect(withDatabase((db) => db.prepare('SELECT count(*) AS count FROM assistant_outbox').get())).toEqual({
    count: 1,
  });
  t.fake.crash();
  const { dataDir, fake } = t;
  await t.close();
  // 模拟进程消失会结束在途回合；此时旧后端监听器已卸载，不消费待发消息。
  await fake.abort({ sessionId, directory: join(dataDir, 'assistant') });
  t = await createTestApp({ dataDir, fake });
  await t.fake.settled();
  expect(notifications()).toHaveLength(1);
  expect(notifications()[0]?.text).toContain('"status": "review"');
  await t.close();
  // 模拟任务事务已提交、进程尚未消费 task_events 就退出的持久化状态。
  withDatabase((db) =>
    db.prepare('UPDATE assistant_task_followups SET last_event_id = 0 WHERE task_id = ?').run(task.id),
  );
  t = await createTestApp({ dataDir, fake });
  await t.fake.settled();
  expect(notifications()).toHaveLength(2);
  await t.close();
  t = await createTestApp({ dataDir, fake });
  await t.fake.settled();
  expect(notifications()).toHaveLength(2);
  expect((await t.call(getTaskOp, { id: task.id })).body.status).toBe(TaskStatus.Review);
});

it('发送失败保留队列，下一条消息带回具体失败阶段和原因，不重新执行任务', async () => {
  input.workflowId = await workflowId(t, 'feature');
  const task = await assistantTask(true);
  t.fake.enqueue(script().hang(), { agent: OPENCODE_ASSISTANT_AGENT });
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '稍后再说', context: HOME });
  const failed = waitForEvent(
    t.app.events,
    ServerEventType.TaskUpdated,
    (item) => item.id === task.id && item.status === TaskStatus.Failed,
  );
  await t.call(startTaskOp, { id: task.id });
  await failed;
  t.fake.failNextPrompt();
  await t.call(abortAssistantOp, { id: conversationId });
  await t.fake.settled();
  expect(withDatabase((db) => db.prepare('SELECT count(*) AS count FROM assistant_outbox').get())).toEqual({
    count: 1,
  });
  expect((await t.call(sendAssistantMessageOp, { id: conversationId, text: '任务怎么样', context: HOME })).status).toBe(
    200,
  );
  await t.fake.settled();
  expect(notifications()).toHaveLength(1);
  expect(notifications()[0]?.text).toContain('"failedPhase": "planning"');
  expect(notifications()[0]?.text).toContain(ErrorCode.AttemptNoResult);
  expect((await t.call(getTaskOp, { id: task.id })).body.status).toBe(TaskStatus.Failed);
  expect(t.fake.sessions.filter((session) => session.agent === 'aw-planner')).toHaveLength(1);
});

it('取消确认、界面创建的任务和已删除原对话都不会被跟进', async () => {
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  try {
    const pending = await callTool(mcp, 'tasks_create', { ...input, [MCP_SESSION_ARG]: sessionId });
    await t.call(cancelAssistantCallOp, { id: String(pending.body.confirmation_id) });
    await t.fake.settled();
  } finally {
    await mcp.close();
  }
  expect((await t.call(listTasksOp, {})).body.items).toEqual([]);
  const direct = (await t.call(createTaskOp, input)).body;
  await runToReview(direct);
  expect(notifications()).toEqual([]);
  const owned = await assistantTask(true);
  expect((await t.call(deleteConversationOp, { id: conversationId })).status).toBe(204);
  await runToReview(owned);
  expect(withDatabase((db) => db.prepare('SELECT count(*) AS count FROM assistant_task_followups').get())).toEqual({
    count: 0,
  });
  expect(notifications()).toEqual([]);
});

it('归属登记失败时创建整体回滚，不发布任务事件或开始工作', async () => {
  const published: string[] = [];
  const unsubscribe = t.app.events.subscribe((event) => {
    if (event.type === ServerEventType.TaskUpdated) published.push(event.data.id);
  });
  await expect(
    t.app.services.tasks.create({ ...input, start: true }, () => {
      throw new AppError(ErrorCode.AssistantConversationNotFound);
    }),
  ).rejects.toMatchObject({ code: ErrorCode.AssistantConversationNotFound });
  unsubscribe();
  expect((await t.call(listTasksOp, {})).body.items).toEqual([]);
  expect(published).toEqual([]);
  expect(t.fake.sessions.map((session) => session.agent)).toEqual([OPENCODE_ASSISTANT_AGENT]);
});

it('确认卡片写明任务基于哪个分支：助手没指定时填上项目的默认分支，确认后照它创建（D215）', async () => {
  await repo.git('branch', 'dev');
  await t.call(updateProjectOp, { id: input.projectId, defaultBranch: 'dev' });
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  try {
    const result = await callTool(mcp, 'tasks_create', { ...input, [MCP_SESSION_ARG]: sessionId });
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card?.input.baseBranch).toBe('dev');
    const confirmed = await t.call(confirmAssistantCallOp, { id: String(result.body.confirmation_id) });
    if (confirmed.body.result?.ok !== true) throw new Error('Task creation was not confirmed');
    expect(createTaskOp.output.parse(confirmed.body.result.output).git.baseBranch).toBe('dev');
  } finally {
    await mcp.close();
  }
});
