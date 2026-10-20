import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectOp,
  createTaskOp,
  getAttemptOp,
  getRuntimeOp,
  getTaskOp,
  InboxKind,
  InboxStatus,
  listWorkflowsOp,
  resolveInboxOp,
  ServerEventType,
  type TaskDetailDTO,
  TaskStatus,
  type TranscriptEntry,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';

/**
 * M3-12 live smoke (07 §6): the built-in bugfix and feature workflows on a small fixture repository with the real
 * opencode and a free model. Run by hand: `pnpm test:live` (AW_LIVE_MODEL overrides the model).
 */
const MODEL = process.env.AW_LIVE_MODEL ?? 'opencode/glm-5.3-flash-free';
const TASK_TIMEOUT_MS = 25 * 60_000;
const FIXTURE = new URL('fixtures/ts-stats', import.meta.url).pathname;
const ENDED: readonly TaskStatus[] = [TaskStatus.Review, TaskStatus.Failed, TaskStatus.Cancelled];
const IDENTITY = ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com'];

type Report = {
  workflow: string;
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
const reports: Report[] = [];

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': MODEL });
  playTheUser();
}, 120_000);

/**
 * Nobody sits in front of a live run: permission requests are allowed once and blocking questions answered with a
 * stock reply, as a cooperative user would (counted in the report).
 */
const userActions = { permissions: 0, answers: 0 };
function playTheUser(): void {
  t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.InboxUpdated || event.data.item.status !== InboxStatus.Open) return;
    const { item } = event.data;
    if (item.kind === InboxKind.Permission) {
      userActions.permissions++;
      void t.call(resolveInboxOp, { id: item.id, response: { decision: 'once' } });
    } else if (item.kind === InboxKind.Question && item.payload.blocking) {
      userActions.answers++;
      void t.call(resolveInboxOp, {
        id: item.id,
        response: { answer: '按你的判断选择最合理的做法，并在结果中写明。' },
      });
    }
  });
}

afterAll(async () => {
  await mkdir(new URL('reports', import.meta.url), { recursive: true });
  const file = new URL(`reports/smoke-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
  await writeFile(file, `${JSON.stringify({ model: MODEL, userActions, reports }, null, 2)}\n`);
  await t.close();
});

/** A fresh Git repository with the fixture project, added with `node --test` as its check. */
async function addFixtureProject(): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-')));
  await cp(FIXTURE, repo, { recursive: true });
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'init'],
  ]) {
    await runGit([...IDENTITY, ...args], { cwd: repo });
  }
  const { body: project } = await t.call(createProjectOp, { repoPath: repo });
  await t.call(updateProjectOp, { id: project.id, checkCommand: 'node --test' });
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

async function runTask(workflowKey: string, requirement: string): Promise<TaskDetailDTO> {
  const projectId = await addFixtureProject();
  const workflow = (await t.call(listWorkflowsOp, {})).body.items.find((w) => w.key === workflowKey);
  if (workflow === undefined) throw new Error(`No workflow ${workflowKey}`);
  const started = Date.now();
  let taskId = '';
  const ended = waitForEvent(
    t.app.events,
    ServerEventType.TaskUpdated,
    (d) => d.id === taskId && ENDED.includes(d.status),
    TASK_TIMEOUT_MS,
  );
  const { body: created } = await t.call(createTaskOp, { projectId, workflowId: workflow.id, requirement });
  taskId = created.id;
  await ended;
  const { body: task } = await t.call(getTaskOp, { id: taskId });
  const attemptIds = [...new Set((await readdir(join(t.dataDir, 'runs', taskId))).map((f) => f.replace('.jsonl', '')))];
  const attempts = await Promise.all(attemptIds.map(async (id) => (await t.call(getAttemptOp, { id })).body));
  reports.push({
    workflow: workflowKey,
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
}

describe('@live 内置流程冒烟', () => {
  it(
    'bugfix：修复 median 的排序缺陷',
    async () => {
      const task = await runTask(
        'bugfix',
        'median 返回了错误的结果：median([10, 9, 1]) 应该是 9，实际是 10。请找到原因并修复。',
      );
      expect(task.status).toBe(TaskStatus.Review);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const worktree = task.git.worktreePath ?? '';
      const { stdout } = await runGit(['log', '--format=%an', `${task.git.baseCommit}..HEAD`], { cwd: worktree });
      expect(stdout).toContain('agent-workflow');
      const probe = await import(join(worktree, 'src/stats.ts'));
      expect(probe.median([10, 9, 1])).toBe(9);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'feature：新增 percentile',
    async () => {
      const task = await runTask(
        'feature',
        '新增函数 percentile(values: number[], p: number): number，返回第 p 百分位数（p 取 0 到 100，线性插值），放在 src/stats.ts，并补充测试。',
      );
      expect(task.status).toBe(TaskStatus.Review);
      expect(task.result?.filesChanged).toBeGreaterThan(0);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );
});
