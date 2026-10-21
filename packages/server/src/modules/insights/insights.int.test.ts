import {
  askKnowledgeOp,
  cancelTaskOp,
  deliverTaskOp,
  ErrorCode,
  insightsSummaryOp,
  insightsTasksOp,
  resolveInboxOp,
  ServerEventType,
  startTaskOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeScript, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, inboxOpens } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ timeZone: 'Asia/Shanghai' });
});
afterEach(() => t.close());

const reaches = (taskId: string, status: string) =>
  waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.id === taskId && d.status === status);

/** A bug-fix task (locate → fix with AI review) whose turns are the given scripts, run until it waits for delivery. */
async function bugfix(projectId: string, turns: { locate: FakeScript; fix: FakeScript[]; review: FakeScript }) {
  const task = await createTask(t, { projectId, workflow: 'bugfix', start: false });
  const directory = `/${task.key}`;
  t.fake.enqueue(turns.locate, { title: '· 定位根因', directory });
  for (const fix of turns.fix) t.fake.enqueue(fix, { title: '· 修复', directory });
  t.fake.enqueue(turns.review, { agent: 'aw-reviewer', directory });
  const review = reaches(task.id, 'review');
  await t.call(startTaskOp, { id: task.id });
  return { task, review };
}

const submit = (s: FakeScript, summary = 'Done') => s.callTool('submit_result', { summary });
const pass = (s: FakeScript) => s.callTool('submit_review', { verdict: 'pass', summary: 'ok' });

describe('质量与用量（19）', () => {
  it('跑完任务与一次知识问答后：用量、拆分、完成率、首次通过、重试、失败原因与打扰', async () => {
    // The check passes once the step changed something: a fix that submits nothing fails it.
    const { project } = await addProject(t, {
      files: { 'src/refund.ts': 'export const refund = (n: number) => n;\n' },
      checkCommand: 'git status --porcelain | grep -q .',
    });

    const first = await bugfix(project.id, {
      locate: submit(script().usage(1000, 100)),
      fix: [submit(script().usage(2000, 200).edit('a.txt', 'a\n'))],
      review: pass(script().usage(500, 50)),
    });
    await first.review;
    await t.fake.settled();

    const permission = inboxOpens(t, 'permission');
    const second = await bugfix(project.id, {
      // An assumed question is only a record; the permission request interrupts the user.
      locate: submit(
        script()
          .usage(1000, 100)
          .ask({ question: 'Which module?', blocking: false, default_assumption: 'refund' })
          .requestPermission('bash', ['make lint']),
      ),
      fix: [submit(script().usage(100, 10)), submit(script().usage(2000, 200).edit('b.txt', 'b\n'))],
      review: pass(script().usage(500, 50)),
    });
    const asked = (await permission).item;
    await t.call(resolveInboxOp, { id: asked.id, response: { decision: 'once' } });
    await second.review;
    await t.fake.settled();

    t.fake.enqueue(
      script()
        .usage(300, 30)
        .callTool('submit_answer', {
          answer: 'It returns the amount [1].',
          citations: [{ type: 'file', path: 'src/refund.ts', start_line: 1, end_line: 1 }],
        }),
      { agent: 'aw-researcher' },
    );
    const answered = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.kind === 'research' && d.attempt.status === 'succeeded',
    );
    await t.call(askKnowledgeOp, {
      projectId: project.id,
      question: 'What does refund return?',
      sources: { code: true, docs: true, database: false, web: false },
    });
    await answered;
    await t.fake.settled();

    await t.call(deliverTaskOp, { id: first.task.id, strategy: 'squash' });
    await t.call(deliverTaskOp, { id: second.task.id, strategy: 'squash' });
    const third = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    await t.call(cancelTaskOp, { id: third.id });

    const { body: summary } = await t.call(insightsSummaryOp, { period: 'today' });
    expect(summary.period.timeZone).toBe('Asia/Shanghai');
    expect(summary.usage).toMatchObject({
      attempts: 8,
      tokensInput: 7400,
      tokensOutput: 740,
    });
    expect(summary.usage.groups.kind.map((g) => [g.key, g.attempts, g.tokensInput])).toEqual([
      ['execute', 5, 6100],
      ['review', 2, 1000],
      ['research', 1, 300],
    ]);
    expect(summary.usage.groups.workflow.map((g) => [g.key, g.name, g.attempts])).toEqual([
      ['bugfix', '修 Bug', 7],
      [null, null, 1],
    ]);
    expect(summary.usage.groups.project).toEqual([expect.objectContaining({ key: project.id, attempts: 8 })]);
    expect(summary.days).toEqual([expect.objectContaining({ tokensInput: 7400, tasksCompleted: 2 })]);
    expect(summary.quality).toMatchObject({
      ended: { completed: 2, cancelled: 1, failed: 0 },
      doneNodes: 4,
      firstPassNodes: 3,
      firstPassRate: 0.75,
      finishedNodes: 4,
      retries: 1,
      avgRetries: 0.25,
      interruptions: 1,
      failureReasons: [{ kind: 'checks_failed', code: null, count: 1 }],
      reviewDurationMedianMs: expect.any(Number),
    });
    expect(summary.quality.completionRate).toBeCloseTo(2 / 3);
    expect(summary.attention.interruptions).toBe(1);

    const { body: tasks } = await t.call(insightsTasksOp, { period: 'today' });
    expect(tasks.items.map((i) => i.task.id)).toEqual([third.id, second.task.id, first.task.id]);
    expect(tasks.items[1]).toMatchObject({
      task: { status: 'completed', project: { id: project.id } },
      usage: { attempts: 4, tokensInput: 3600, tokensOutput: 360 },
      kinds: ['execute', 'review'],
      quality: {
        doneNodes: 2,
        firstPassNodes: 1,
        retries: 1,
        interruptions: 1,
        failureReasons: [{ kind: 'checks_failed', code: null, count: 1 }],
        reviewDurationMs: expect.any(Number),
      },
    });
    expect(tasks.items[0]).toMatchObject({ usage: { attempts: 0 }, quality: { doneNodes: 0, reviewDurationMs: null } });
    // Two whole tasks, a knowledge question and two merges: longer than the default 5 s when every suite runs at once.
  }, 20_000);

  it('自定义时间段要有起止日期（VALIDATION_FAILED）', async () => {
    const res = await t.call(insightsSummaryOp, { period: 'custom' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
  });
});
