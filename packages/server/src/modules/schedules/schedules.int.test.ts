import {
  createScheduleOp,
  deleteProjectOp,
  ErrorCode,
  getScheduleOp,
  getTaskOp,
  InboxStatus,
  listInboxOp,
  listSchedulesOp,
  pauseScheduleOp,
  resumeScheduleOp,
  runScheduleOp,
  SCHEDULE_CHECK_INTERVAL_MS,
  type ScheduleDetailDTO,
  type ScheduleFrequency,
} from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { addProject, taskReaches } from '../../../test/helpers/tasks.ts';

const ZONE = 'Asia/Shanghai';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2026-10-21 01:00 in Shanghai. */
const START = Date.parse('2026-10-20T17:00:00Z');
/** 02:00 in Shanghai on the day `START` falls on. */
const TWO_AM = Date.parse('2026-10-20T18:00:00Z');
const DAILY: ScheduleFrequency = { kind: 'daily', time: '02:00' };

let t: TestApp;
let clock: FakeClock;
const open = async (start = START, reuse?: TestApp) => {
  clock = createFakeClock(start);
  t = await createTestApp({
    clock,
    timeZone: ZONE,
    ...(reuse === undefined ? {} : { dataDir: reuse.dataDir, fake: reuse.fake }),
  });
};
afterEach(() => t.close());

/** Moves the clock check by check, waiting for each check of the schedules to finish (07 §4: no real waiting). */
async function passTime(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= SCHEDULE_CHECK_INTERVAL_MS) {
    clock.advance(Math.min(SCHEDULE_CHECK_INTERVAL_MS, left));
    await t.app.services.schedules.settled();
  }
}

/** The code review of the n-th task of a fresh app: one turn that submits the report. */
const queueReview = (n: number) =>
  t.fake.enqueue(script().callTool('submit_result', { summary: `Review ${n}: fine` }), { title: `T-${n} · 代码审查` });

async function createSchedule(
  projectId: string,
  extra: { workflowKey?: string; frequency?: ScheduleFrequency; baseBranch?: string } = {},
): Promise<ScheduleDetailDTO> {
  const res = await t.call(createScheduleOp, {
    projectId,
    workflowKey: 'code_review',
    requirement: '审查订单模块\n重点看并发',
    frequency: DAILY,
    ...extra,
  });
  if (res.status !== 201) throw new Error(`createSchedule failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

const detail = async (id: string) => (await t.call(getScheduleOp, { id })).body;
const openInbox = async () => (await t.call(listInboxOp, { status: InboxStatus.Open })).body.items;

describe('定时任务：到点运行（22 §4）', () => {
  it('到点开一个普通任务（不确认计划），结果在「需要你处理」待合并；第二天上一次还没合并，跳过并记录', async () => {
    await open();
    const { project } = await addProject(t, { checkCommand: null });
    const schedule = await createSchedule(project.id);
    expect(schedule).toMatchObject({ title: '审查订单模块', status: 'active', nextRunAt: TWO_AM, runs: [] });
    queueReview(1);
    const review = taskReaches(t, 'review');

    await passTime(HOUR);
    await review;
    await t.fake.settled();

    const ran = await detail(schedule.id);
    expect(ran.runs).toMatchObject([{ trigger: 'on_time', outcome: 'started', dueAt: TWO_AM, missed: 0 }]);
    const taskId = ran.runs[0]?.task?.id ?? '';
    const task = (await t.call(getTaskOp, { id: taskId })).body;
    expect(task).toMatchObject({
      requirement: '审查订单模块\n重点看并发',
      status: 'review',
      workflow: { key: 'code_review' },
    });
    expect(task.checkpoints.confirm_plan).toBe(false);
    expect(ran).toMatchObject({ activeTask: { id: taskId }, nextRunAt: TWO_AM + DAY });
    expect(await openInbox()).toMatchObject([{ kind: 'delivery', taskId }]);

    await passTime(DAY);

    const skipped = await detail(schedule.id);
    expect(skipped.runs.map((r) => [r.outcome, r.dueAt, r.task?.id ?? null])).toEqual([
      ['skipped', TWO_AM + DAY, null],
      ['started', TWO_AM, taskId],
    ]);
    expect(skipped.nextRunAt).toBe(TWO_AM + 2 * DAY);
    expect((await t.call(listSchedulesOp, {})).body.items).toMatchObject([
      { id: schedule.id, lastRun: { outcome: 'skipped' }, activeTask: { id: taskId } },
    ]);
  });

  it('应用关闭期间错过的多次，重新打开后只补跑一次，记下错过的次数', async () => {
    await open();
    const { project } = await addProject(t, { checkCommand: null });
    const schedule = await createSchedule(project.id);
    const closed = t;
    await closed.close();

    // Opened again three days later at 08:00: 02:00 of the 21st, 22nd, 23rd and 24th have passed.
    await open(START + 3 * DAY + 7 * HOUR, closed);
    queueReview(1);
    const review = taskReaches(t, 'review');
    await passTime(1);
    await review;
    await t.fake.settled();

    const { runs } = await detail(schedule.id);
    expect(runs).toMatchObject([{ trigger: 'catch_up', outcome: 'started', dueAt: TWO_AM + 3 * DAY, missed: 3 }]);
    expect((await detail(schedule.id)).nextRunAt).toBe(TWO_AM + 4 * DAY);
  });

  it('暂停后到点不运行；恢复后从现在起算下一次', async () => {
    await open();
    const { project } = await addProject(t, { checkCommand: null });
    const schedule = await createSchedule(project.id);

    expect((await t.call(pauseScheduleOp, { id: schedule.id })).body).toMatchObject({
      status: 'paused',
      nextRunAt: null,
    });
    await passTime(2 * DAY);
    expect((await detail(schedule.id)).runs).toEqual([]);

    const resumed = (await t.call(resumeScheduleOp, { id: schedule.id })).body;
    expect(resumed).toMatchObject({ status: 'active', nextRunAt: TWO_AM + 2 * DAY, runs: [] });
    expect((await t.call(resumeScheduleOp, { id: schedule.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });
});

describe('定时任务：开不了任务（22 §5）', () => {
  it('基础分支被删后到点失败：记录原因、自动暂停、「需要你处理」有条目；恢复后条目关闭', async () => {
    await open();
    const { repo, project } = await addProject(t, { checkCommand: null });
    await repo.git('branch', 'nightly');
    const schedule = await createSchedule(project.id, { baseBranch: 'nightly' });
    await repo.git('branch', '-D', 'nightly');

    await passTime(HOUR);

    const failed = await detail(schedule.id);
    expect(failed).toMatchObject({ status: 'paused', nextRunAt: null, activeTask: null });
    expect(failed.runs).toMatchObject([
      { outcome: 'failed', task: null, error: { code: ErrorCode.GitBaseBranchNotFound } },
    ]);
    expect(await openInbox()).toMatchObject([
      {
        kind: 'schedule_failure',
        taskId: null,
        title: '审查订单模块',
        payload: { scheduleId: schedule.id, error: { code: ErrorCode.GitBaseBranchNotFound } },
      },
    ]);

    await repo.git('branch', 'nightly');
    await t.call(resumeScheduleOp, { id: schedule.id });
    expect(await openInbox()).toEqual([]);
  });
});

describe('定时任务：创建、立即运行与删除（22 §9）', () => {
  it('AI 规划的流程不能定时：400 VALIDATION_FAILED', async () => {
    await open();
    const { project } = await addProject(t);
    const res = await t.call(createScheduleOp, {
      projectId: project.id,
      workflowKey: 'feature',
      requirement: '加日志',
      frequency: DAILY,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed, details: { issues: [{ path: ['workflowKey'] }] } },
    });
  });

  it('立即运行一次不改变计划时刻；上一次还没结束时 409 SCHEDULE_BUSY', async () => {
    await open();
    const { project } = await addProject(t, { checkCommand: null });
    const schedule = await createSchedule(project.id);
    queueReview(1);
    const review = taskReaches(t, 'review');

    const ran = (await t.call(runScheduleOp, { id: schedule.id })).body;
    await review;
    await t.fake.settled();

    expect(ran).toMatchObject({ nextRunAt: TWO_AM, runs: [{ trigger: 'manual', outcome: 'started', dueAt: START }] });
    const busy = await t.call(runScheduleOp, { id: schedule.id });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: { code: ErrorCode.ScheduleBusy } });
  });

  it('同时点两次「立即运行」：只开一个任务，另一次 409 SCHEDULE_BUSY', async () => {
    await open();
    const { project } = await addProject(t, { checkCommand: null });
    const schedule = await createSchedule(project.id);
    queueReview(1);
    const review = taskReaches(t, 'review');

    // Both pass the first check before either has created its task.
    const both = await Promise.all([
      t.call(runScheduleOp, { id: schedule.id }),
      t.call(runScheduleOp, { id: schedule.id }),
    ]);
    await review;
    await t.fake.settled();

    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const { body } = await t.call(getScheduleOp, { id: schedule.id });
    expect(body.runs).toMatchObject([{ trigger: 'manual', outcome: 'started' }]);
  });

  it('不存在的定时任务 404；删除项目后定时任务随之删除', async () => {
    await open();
    const { project } = await addProject(t);
    const schedule = await createSchedule(project.id);

    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);

    const res = await t.call(getScheduleOp, { id: schedule.id });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ScheduleNotFound } });
  });
});
