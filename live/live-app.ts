import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attemptMachine,
  createProjectOp,
  createTaskOp,
  getAttemptOp,
  getRuntimeOp,
  getTaskOp,
  InboxKind,
  InboxStatus,
  isTerminalState,
  listWorkflowsOp,
  resolveInboxOp,
  ServerEventType,
  type TaskDetailDTO,
  TaskStatus,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL as MODEL } from '../packages/server/test/helpers/model.ts';

/** Shared by the live suites (07 §6): the real opencode, the free test model, fixture repositories, one report. */
export const TASK_TIMEOUT_MS = 25 * 60_000;
const ENDED: readonly TaskStatus[] = [TaskStatus.Review, TaskStatus.Failed, TaskStatus.Cancelled];
const IDENTITY = ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com'];

export type Fixture = 'ts-stats' | 'java-inventory';

type Report = {
  workflow: string;
  fixture: Fixture;
  status: TaskStatus;
  minutes: number;
  attempts: Array<{
    kind: string;
    status: string;
    nudges: number;
    tokensInput: number | null;
    tokensOutput: number | null;
    cost: number | null;
  }>;
  submitCalls: { ok: number; failed: number };
  failure: TaskDetailDTO['failure'];
};

export type LiveApp = {
  t: TestApp;
  /** Runs a task until it ends (or, with `confirmPlan`, until its plan waits for confirmation). */
  runTask(
    workflowKey: string,
    fixture: Fixture,
    requirement: string,
    options?: { confirmPlan: boolean },
  ): Promise<TaskDetailDTO>;
  /** Writes `live/reports/<name>-<time>.json` and closes the app. */
  close(): Promise<void>;
};

export async function startLiveApp(name: string): Promise<LiveApp> {
  const t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': MODEL });
  const reports: Report[] = [];
  const userActions = playTheUser(t);

  /** A fresh Git repository with the fixture project, added as a user would: the check command is inferred. */
  async function addFixtureProject(fixture: Fixture): Promise<string> {
    const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-')));
    await cp(new URL(`fixtures/${fixture}`, import.meta.url).pathname, repo, { recursive: true });
    await writeFile(join(repo, '.gitignore'), 'target/\n');
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'init'],
    ]) {
      await runGit([...IDENTITY, ...args], { cwd: repo });
    }
    const { body: project } = await t.call(createProjectOp, { repoPath: repo });
    return project.id;
  }

  /** Counts accepted and rejected calls of the submit tools in every transcript of the task. */
  async function submitCalls(taskId: string): Promise<Report['submitCalls']> {
    const dir = join(t.dataDir, 'runs', taskId);
    const counts = { ok: 0, failed: 0 };
    for (const file of await readdir(dir)) {
      const entries: TranscriptEntry[] = (await readFile(join(dir, file), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      for (const e of entries) {
        if (e.kind !== 'tool_result' || !/^agent-workflow_submit_/.test(e.data.tool)) continue;
        if (e.data.status === 'completed') counts.ok++;
        else counts.failed++;
      }
    }
    return counts;
  }

  return {
    t,
    async runTask(workflowKey, fixture, requirement, options = { confirmPlan: false }) {
      const until = options.confirmPlan ? [...ENDED, TaskStatus.PlanReview] : ENDED;
      const projectId = await addFixtureProject(fixture);
      const workflow = (await t.call(listWorkflowsOp, {})).body.items.find((w) => w.key === workflowKey);
      if (workflow === undefined) throw new Error(`No workflow ${workflowKey}`);
      const started = Date.now();
      let taskId = '';
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.TaskUpdated,
        (d) => d.id === taskId && until.includes(d.status),
        TASK_TIMEOUT_MS,
      );
      const { body: created } = await t.call(createTaskOp, {
        projectId,
        workflowId: workflow.id,
        requirement,
        checkpoints: { confirm_plan: options.confirmPlan },
      });
      taskId = created.id;
      await ended;
      // The status changes inside the submit call; its result reaches the transcript when the call returns, and
      // the attempt ends after that. Read transcripts only once every attempt of the task has ended.
      const endedAttempts = new Set<string>();
      let waitingFor: readonly string[] | undefined;
      let allEnded = () => {};
      const settled = new Promise<void>((resolve) => {
        allEnded = resolve;
      });
      const unsubscribe = t.app.events.subscribe((e) => {
        if (e.type !== ServerEventType.AttemptUpdated || e.data.taskId !== taskId) return;
        if (isTerminalState(attemptMachine, e.data.attempt.status)) endedAttempts.add(e.data.attempt.id);
        if (waitingFor?.every((id) => endedAttempts.has(id))) allEnded();
      });
      waitingFor = (await t.call(getTaskOp, { id: taskId })).body.activeAttempts.map((a) => a.id);
      if (waitingFor.every((id) => endedAttempts.has(id))) allEnded();
      await settled;
      unsubscribe();
      const { body: task } = await t.call(getTaskOp, { id: taskId });
      const attemptIds = [
        ...new Set((await readdir(join(t.dataDir, 'runs', taskId))).map((f) => f.replace('.jsonl', ''))),
      ];
      const attempts = await Promise.all(attemptIds.map(async (id) => (await t.call(getAttemptOp, { id })).body));
      reports.push({
        workflow: workflowKey,
        fixture,
        status: task.status,
        minutes: Math.round((Date.now() - started) / 6000) / 10,
        attempts: attempts.map(({ kind, status, nudges, tokensInput, tokensOutput, cost }) => ({
          kind,
          status,
          nudges,
          tokensInput,
          tokensOutput,
          cost,
        })),
        submitCalls: await submitCalls(taskId),
        failure: task.failure,
      });
      return task;
    },
    async close() {
      await mkdir(new URL('reports', import.meta.url), { recursive: true });
      const file = new URL(`reports/${name}-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
      // Which kind of session asked for each permission (the planner and reviewer only read).
      const asked = await Promise.all(
        userActions.asked.map(async ({ attemptId, ask }) => ({
          kind: attemptId === null ? null : (await t.call(getAttemptOp, { id: attemptId })).body.kind,
          ask,
        })),
      );
      await writeFile(
        file,
        `${JSON.stringify({ model: MODEL, userActions: { ...userActions, asked }, reports }, null, 2)}\n`,
      );
      await t.close();
    },
  };
}

/**
 * Nobody sits in front of a live run: permission requests are allowed once and blocking questions answered with a
 * stock reply, as a cooperative user would (counted in the report).
 */
function playTheUser(t: TestApp) {
  const userActions = { permissions: 0, answers: 0, asked: [] as Array<{ attemptId: string | null; ask: string }> };
  t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.InboxUpdated || event.data.item.status !== InboxStatus.Open) return;
    const { item } = event.data;
    if (item.kind === InboxKind.Permission) {
      userActions.permissions++;
      userActions.asked.push({
        attemptId: item.attemptId,
        ask: `${item.payload.permission}: ${item.payload.patterns.join(' | ')}`,
      });
      void t.call(resolveInboxOp, { id: item.id, response: { decision: 'once' } });
    } else if (item.kind === InboxKind.Question && item.payload.blocking) {
      userActions.answers++;
      void t.call(resolveInboxOp, {
        id: item.id,
        response: { answer: '按你的判断选择最合理的做法，并在结果中写明。' },
      });
    }
  });
  return userActions;
}

/** Status and, when the task failed, the code and message of the failure (with its details). */
export const outcome = (task: TaskDetailDTO) => ({
  status: task.status,
  failure:
    task.failure === null
      ? null
      : `${task.failure.code}: ${task.failure.message} ${JSON.stringify(task.failure.details ?? {})}`,
});
