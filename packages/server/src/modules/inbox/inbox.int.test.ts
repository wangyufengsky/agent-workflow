import {
  countInboxOp,
  dismissInboxOp,
  ErrorCode,
  getProjectOp,
  getTaskOp,
  type InboxItemDTO,
  listInboxOp,
  removeProjectAllowedBashOp,
  resolveInboxOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, inboxOpens, nodeReaches, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const locate = { title: '定位根因' };
const submit = (summary: string) => script().callTool('submit_result', { summary });
const toolResult = (name: string) => t.fake.toolCalls.filter((c) => c.name === name).map((c) => c.result);

async function bugfixTask(checkpoints: Record<string, boolean> = {}) {
  const { project } = await addProject(t, { checkCommand: null });
  return createTask(t, { projectId: project.id, workflow: 'bugfix', checkpoints });
}

describe('ask_user（12 §6.7）', () => {
  it('不提问且给出默认假设：记为已按假设处理，返回 proceed_with，进入上下文与结果的假设', async () => {
    t.fake.enqueue(
      script()
        .ask({ question: 'Which locale?', blocking: false, default_assumption: 'en-US' })
        .callTool('get_task_context')
        .callTool('submit_result', { summary: 'Located' }),
      locate,
    );
    const done = nodeReaches(t, 'locate', 'done');
    const task = await bugfixTask();
    await done;
    await t.fake.settled();

    expect(toolResult('ask_user')).toEqual([{ status: 'assumed', proceed_with: 'en-US' }]);
    expect(toolResult('get_task_context')[0]).toMatchObject({
      answeredQuestions: [{ question: 'Which locale?', answer: '(assumed) en-US' }],
    });
    expect((await t.call(listInboxOp, { taskId: task.id })).body.items).toMatchObject([
      { kind: 'question', status: 'resolved', response: { assumed: true, value: 'en-US' } },
    ]);
  });

  it('不提问、不阻塞且没有默认假设：VALIDATION_FAILED 与 hint', async () => {
    t.fake.enqueue(
      script().ask({ question: 'Which locale?', blocking: false }).callTool('submit_result', { summary: 'x' }),
      locate,
    );
    const done = nodeReaches(t, 'locate', 'done');
    await bugfixTask();
    await done;
    await t.fake.settled();
    expect(toolResult('ask_user')).toEqual([
      expect.objectContaining({
        code: ErrorCode.ValidationFailed,
        hint: expect.stringContaining('default_assumption'),
      }),
    ]);
  });

  it('阻塞提问：结束本轮 → 节点等待输入 → 在「需要你处理」作答 → 答案作为下一条消息发回同一会话 → 完成', async () => {
    t.fake.enqueue(script().ask({ question: 'Which table?', blocking: true, options: ['a', 'b'] }), locate);
    t.fake.enqueue(script().callTool('get_task_context').callTool('submit_result', { summary: 'Used a' }), locate);
    const waiting = nodeReaches(t, 'locate', 'waiting_input');
    const task = await bugfixTask();
    await waiting;
    expect(toolResult('ask_user')).toEqual([
      { status: 'queued', instruction: 'End your turn now. The answer will be sent as the next message.' },
    ]);
    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    expect(detail.displayGroup).toBe('needs_attention');
    const [question] = detail.openInbox;
    expect(question).toMatchObject({ kind: 'question', payload: { options: ['a', 'b'], blocking: true } });
    expect((await t.call(countInboxOp, {})).body.blocking).toBe(1);

    const done = nodeReaches(t, 'locate', 'done');
    const res = await t.call(resolveInboxOp, { id: question?.id ?? '', response: { answer: 'a' } });
    expect(res.body).toMatchObject({ status: 'resolved', response: { answer: 'a' } });
    await done;
    await t.fake.settled();
    // Once locate is done the fix step starts in a session of its own, so the answer is not necessarily the last prompt.
    const answer = t.fake.prompts.find((p) => p.text.includes('Answer: a'));
    expect(answer?.sessionId).toBe(t.fake.prompts[0]?.sessionId);
    expect(answer?.text).toContain('Question: Which table?');
    expect(toolResult('get_task_context')[0]).toMatchObject({
      answeredQuestions: [{ question: 'Which table?', answer: 'a' }],
    });
  });

  it('非阻塞提问在会话忙时作答：答案在下一次空闲时发送；权限请求 → 允许一次 → 继续', async () => {
    await t.call(updateSettingsOp, { 'ai.askOnUncertainty': true });
    t.fake.enqueue(
      script().ask({ question: 'Name the flag?', blocking: false }).requestPermission('bash', ['rm -rf dist']),
      locate,
    );
    t.fake.enqueue(submit('Located with flag'), locate);
    const permission = inboxOpens(t, 'permission');
    const task = await bugfixTask();
    const asked = (await permission).item;
    if (asked.kind !== 'permission') throw new Error('expected a permission item');
    expect(asked).toMatchObject({
      title: 'bash rm -rf dist',
      payload: { permission: 'bash', patterns: ['rm -rf dist'] },
    });
    expect(toolResult('ask_user')).toEqual([
      { status: 'queued', instruction: 'Continue working; the answer will be sent when available.' },
    ]);
    expect((await t.call(getTaskOp, { id: task.id })).body.nodes[0]?.status).toBe('waiting_input');

    const question = (await t.call(listInboxOp, { taskId: task.id, status: 'open' })).body.items.find(
      (i: InboxItemDTO) => i.kind === 'question',
    );
    await t.call(resolveInboxOp, { id: question?.id ?? '', response: { answer: 'verbose' } });
    // Still waiting for the permission: nothing is sent yet.
    expect(t.fake.prompts).toHaveLength(1);

    const done = nodeReaches(t, 'locate', 'done');
    const running = nodeReaches(t, 'locate', 'running');
    await t.call(resolveInboxOp, { id: asked.id, response: { decision: 'once' } });
    await running;
    await done;
    expect(t.fake.permissionReplies).toEqual([{ permissionId: asked.payload.opencodePermissionId, reply: 'once' }]);
    expect(t.fake.prompts[1]?.text).toContain('Answer: verbose');
  });
});

describe('权限的「总是允许」记到项目（D101）', () => {
  it('本任务记住的包脚本仅在相同目录与入口上复用，其他任务独立询问', async () => {
    await t.call(updateSettingsOp, { 'ai.bashPolicy': 'ask' });
    const command = 'npm test';
    const manifest = JSON.stringify({ scripts: { test: 'node test.js' } });
    const { project } = await addProject(t, {
      checkCommand: null,
      files: {
        'package.json': manifest,
        'test.js': 'console.log(1)',
        'sub/package.json': manifest,
        'sub/test.js': 'console.log(1)',
      },
    });
    t.fake.enqueue(
      script()
        .requestPermission('bash', [command], { command })
        .requestPermission('bash', [command], { command })
        .requestPermission('bash', [command], { command, workdir: 'sub' })
        .edit('package.json', JSON.stringify({ scripts: { test: 'node test.js --changed' } }))
        .requestPermission('bash', [command], { command })
        .hang(),
      locate,
    );
    const first = inboxOpens(t, 'permission');
    await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    const { item } = await first;
    const sub = inboxOpens(t, 'permission');
    const answered = await t.call(resolveInboxOp, { id: item.id, response: { decision: 'always', scope: 'task' } });
    expect(answered.body.response).toEqual({ decision: 'always', scope: 'task' });
    const subdir = (await sub).item;
    expect(subdir).toMatchObject({ payload: { bashGrant: { relativeDirectory: 'sub' } } });
    const changed = inboxOpens(t, 'permission');
    await t.call(resolveInboxOp, { id: subdir.id, response: { decision: 'once' } });
    expect((await changed).item).toMatchObject({ payload: { bashGrant: { relativeDirectory: '.' } } });
    expect((await t.call(getProjectOp, { id: project.id })).body.exactBash).toEqual([]);
    t.fake.enqueue(script().requestPermission('bash', [command], { command }).hang(), locate);
    const independent = inboxOpens(t, 'permission');
    const other = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    expect((await independent).item).toMatchObject({ taskId: other.id, payload: { bashGrant: { command } } });
  });

  it('项目精确授权可撤销，换参数或更改脚本都再次询问', async () => {
    await t.call(updateSettingsOp, { 'ai.bashPolicy': 'ask' });
    const { project } = await addProject(t, { checkCommand: null, files: { 'build.sh': 'echo start' } });
    const cmd = './build.sh --clean';
    t.fake.enqueue(
      script()
        .requestPermission('bash', [cmd], { command: cmd })
        .requestPermission('bash', [cmd], { command: cmd })
        .requestPermission('bash', ['./build.sh --all'], { command: './build.sh --all' })
        .edit('build.sh', 'echo changed')
        .requestPermission('bash', [cmd], { command: cmd })
        .hang(),
      locate,
    );
    const next = () => inboxOpens(t, 'permission');
    const first = next();
    await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    const asked = (await first).item;
    const second = next();
    expect(
      (await t.call(resolveInboxOp, { id: asked.id, response: { decision: 'always', scope: 'project' } })).status,
    ).toBe(200);
    const changedArgs = (await second).item;
    expect(changedArgs.title).toContain('--all');
    const third = next();
    await t.call(resolveInboxOp, { id: changedArgs.id, response: { decision: 'once' } });
    expect((await third).item.title).toContain('--clean');
    const detail = (await t.call(getProjectOp, { id: project.id })).body;
    expect(detail.allowedBash).toEqual([]);
    expect(detail.exactBash).toMatchObject([{ command: cmd, directory: '.' }]);
    // 新任务使用独立工作区。同一项目、同一入口可以复用，撤销后立即重新询问。
    const otherCommand = './build.sh --inspect';
    t.fake.enqueue(
      script()
        .requestPermission('bash', [cmd], { command: cmd })
        .requestPermission('bash', [otherCommand], { command: otherCommand })
        .requestPermission('bash', [cmd], { command: cmd })
        .hang(),
      locate,
    );
    const waiting = next();
    const other = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    const inspection = (await waiting).item;
    expect(inspection).toMatchObject({ taskId: other.id, payload: { bashGrant: { command: otherCommand } } });
    const revoked = await t.call(removeProjectAllowedBashOp, {
      id: project.id,
      pattern: 'exact:' + detail.exactBash[0]?.id,
    });
    expect(revoked.body.exactBash).toEqual([]);
    const afterRevoke = next();
    await t.call(resolveInboxOp, { id: inspection.id, response: { decision: 'once' } });
    expect((await afterRevoke).item).toMatchObject({ taskId: other.id, payload: { bashGrant: { command: cmd } } });
  });
});

describe('其他条目', () => {
  it('计划条目作答即确认；失败条目可重试或取消，也可忽略；投递条目不能直接作答；已关闭的条目 409', async () => {
    const plan = inboxOpens(t, 'plan');
    const task = await bugfixTask({ confirm_plan: true });
    const planItem = (await plan).item;
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const failure = inboxOpens(t, 'failure');
    const confirmed = await t.call(resolveInboxOp, { id: planItem.id, response: { confirmed: true } });
    expect(confirmed.body).toMatchObject({ status: 'resolved', response: { confirmed: true } });
    expect((await t.call(resolveInboxOp, { id: planItem.id, response: { confirmed: true } })).body).toMatchObject({
      error: { code: ErrorCode.InboxItemClosed },
    });

    const failureItem = (await failure).item;
    expect(failureItem).toMatchObject({
      payload: { phase: 'running', error: { code: ErrorCode.NodeAttemptsExhausted } },
    });
    expect((await t.call(resolveInboxOp, { id: failureItem.id, response: { answer: 'x' } })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
    const cancelled = taskReaches(t, 'cancelled');
    await t.call(resolveInboxOp, { id: failureItem.id, response: { action: 'cancel' } });
    await cancelled;
    expect((await t.call(listInboxOp, { taskId: task.id })).body.items.map((i) => [i.kind, i.status])).toEqual([
      ['failure', 'resolved'],
      ['plan', 'resolved'],
    ]);
  });

  it('待合并时有投递条目：不计入徽标（D119），不能作答，可以忽略；问题条目不能忽略', async () => {
    t.fake.enqueue(submit('Located'), locate);
    t.fake.enqueue(submit('Fixed'), { title: '· 修复' });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    const delivery = inboxOpens(t, 'delivery');
    await bugfixTask();
    const { item, blockingCount } = await delivery;
    // A delivery is a result waiting to be merged, not something holding a task up.
    expect(blockingCount).toBe(0);
    expect((await t.call(countInboxOp, {})).body.blocking).toBe(0);
    // Lists filter on the server, so a page of deliveries cannot hide an older blocking item.
    const listed = async (blocking: boolean) =>
      (await t.call(listInboxOp, { status: 'open', blocking })).body.items.map((i) => i.kind);
    expect(await listed(true)).toEqual([]);
    expect(await listed(false)).toEqual(['delivery']);
    expect((await t.call(resolveInboxOp, { id: item.id, response: { confirmed: true } })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
    expect((await t.call(dismissInboxOp, { id: item.id })).body).toMatchObject({ status: 'dismissed' });
  });

  it('节点结束时自动忽略它仍未回答的问题', async () => {
    await t.call(updateSettingsOp, { 'ai.askOnUncertainty': true });
    t.fake.enqueue(
      script().ask({ question: 'Optional?', blocking: false }).callTool('submit_result', { summary: 'x' }),
      locate,
    );
    const done = nodeReaches(t, 'locate', 'done');
    const task = await bugfixTask();
    await done;
    const [question] = (await t.call(listInboxOp, { taskId: task.id, status: 'dismissed' })).body.items;
    expect(question).toMatchObject({ kind: 'question', title: 'Optional?' });
    expect((await t.call(dismissInboxOp, { id: question?.id ?? '' })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
  });
});
