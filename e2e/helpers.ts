import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';

/**
 * Waits that span a whole task run (worktree, steps with checks and commits, review) until its result card, or a merge
 * (several git commands under the repository lock, then the worktree removal). Measured
 * in CI (17 §4.1): J4 from start to failure takes 0.2 s on macOS, 0.8 s on Ubuntu and 3.6 s on the Windows runner,
 * where every git and shell process start costs ~100 ms or more; J7 / J5 runs crossed 5 s there, and creating one
 * worktree took up to 9.3 s, and a squash merge waiting for the lock behind two running tasks 2.9 s before its cleanup.
 * Only Windows waits longer.
 */
export const TASK_RUN_TIMEOUT_MS = process.platform === 'win32' ? 20_000 : 5_000;

/**
 * Specs that chain several task runs and merges in one test exceed the 30 s test budget on the Windows runner, where
 * a single squash merge once took 16 s (17 §4.1); they are marked `test.slow` there only.
 */
export const GIT_HEAVY_SPECS_SLOW = process.platform === 'win32';

/** Runs git in a repository (`LC_ALL=C`, like the backend) and returns its trimmed output. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
    cwd,
    env: { ...process.env, LC_ALL: 'C' },
  })
    .toString()
    .trim();
}

/** A real Git repository with one commit on main. */
export function createRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aw-e2e-repo-')));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

export async function patchSettings(request: APIRequestContext, patch: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`${API_BASE}/settings`, { headers: AUTH, data: patch });
  if (!res.ok()) throw new Error(`PATCH /settings failed: ${res.status()} ${await res.text()}`);
}

export type E2EProject = { id: string; name: string; slug: string; repoPath: string };

/** A fresh repository added as a project; `checkCommand` replaces the inferred one (null = none). */
export async function createProject(request: APIRequestContext, checkCommand: string | null): Promise<E2EProject> {
  const repoPath = createRepo();
  const created = await request.post(`${API_BASE}/projects`, { headers: AUTH, data: { repoPath } });
  if (!created.ok()) throw new Error(`POST /projects failed: ${created.status()} ${await created.text()}`);
  const project: E2EProject = await created.json();
  const updated = await request.patch(`${API_BASE}/projects/${project.id}`, { headers: AUTH, data: { checkCommand } });
  if (!updated.ok()) throw new Error(`PATCH /projects failed: ${updated.status()}`);
  return project;
}

/** One turn of FakeOpencode (packages/server/test/fakes); the backend runs with AW_FAKE_OPENCODE=1. */
export type FakeStep =
  | { type: 'edit'; file: string; content: string }
  | { type: 'text'; text: string }
  | { type: 'think'; text: string }
  /** A native read-only tool call (`read`, `grep` …), reported only. */
  | { type: 'tool'; tool: string; input: Record<string, unknown>; output?: string }
  /** `server: 'assistant'` calls the assistant MCP (15 §3); the execution MCP otherwise. */
  | { type: 'callTool'; server?: 'exec' | 'assistant'; name: string; args: Record<string, unknown> }
  | { type: 'permission'; permission: string; patterns: string[] }
  /** Keeps working until the session is aborted. */
  | { type: 'hang' }
  /** The model provider fails the turn; `idle: false` leaves the session without an idle event. */
  | { type: 'error'; name: string; message: string; idle?: boolean }
  /** The tokens the turn reports when it ends; 100 input and 20 output otherwise. */
  | { type: 'usage'; input: number; output: number };

export const submitResult = (summary: string): FakeStep => ({
  type: 'callTool',
  name: 'submit_result',
  args: { summary },
});
export const passReview: FakeStep = {
  type: 'callTool',
  name: 'submit_review',
  args: { verdict: 'pass', summary: '通过' },
};

/**
 * Queues a turn for the next matching session of this project's tasks (sessions run in the project's worktrees, so
 * the directory keeps specs apart); `title` or `agent` narrow it to a step or the planner/reviewer, `taskKey` to one
 * task (its worktree is `<project slug>/<task key>`).
 */
export async function queueTurn(
  request: APIRequestContext,
  project: E2EProject,
  match: { title?: string; agent?: string; taskKey?: string },
  steps: FakeStep[],
): Promise<void> {
  const { taskKey, ...rest } = match;
  const directory = taskKey === undefined ? `/${project.slug}/` : `/${project.slug}/${taskKey}`;
  const res = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { ...rest, directory }, steps },
  });
  if (!res.ok()) throw new Error(`queueing a fake turn failed: ${res.status()} ${await res.text()}`);
}

/** Queues a turn for the knowledge researcher of this project (its sessions run in the project repository, 18 §5). */
export async function queueResearchTurn(
  request: APIRequestContext,
  project: E2EProject,
  steps: FakeStep[],
): Promise<void> {
  const res = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { agent: 'aw-researcher', directory: project.repoPath }, steps },
  });
  if (!res.ok()) throw new Error(`queueing a research turn failed: ${res.status()} ${await res.text()}`);
}

/** Queues a turn for the PPT writer of this project (its sessions run in the project repository, 23 §7.1). */
export async function queueWriterTurn(
  request: APIRequestContext,
  project: E2EProject,
  steps: FakeStep[],
): Promise<void> {
  const res = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { agent: 'aw-slides', directory: project.repoPath }, steps },
  });
  if (!res.ok()) throw new Error(`queueing a writer turn failed: ${res.status()} ${await res.text()}`);
}

/** Queues a turn for the next message to the app assistant (its sessions run as `aw-assistant`). */
export async function queueAssistantTurn(request: APIRequestContext, steps: FakeStep[]): Promise<void> {
  const res = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { agent: 'aw-assistant' }, steps },
  });
  if (!res.ok()) throw new Error(`queueing an assistant turn failed: ${res.status()} ${await res.text()}`);
}

export const appTool = (name: string, args: Record<string, unknown>): FakeStep => ({
  type: 'callTool',
  server: 'assistant',
  name,
  args,
});

/**
 * Home page of the project (the select writes the same `?projectId=`), then a workflow under「直接开始」, which puts
 * the input in「开始任务」mode (D111), the requirement and start.
 */
export async function startTask(page: Page, project: E2EProject, workflow: RegExp, requirement: string): Promise<void> {
  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('group', { name: '直接开始' }).getByRole('button', { name: workflow }).click();
  const projectSelect = page.getByLabel('项目', { exact: true });
  if ((await projectSelect.count()) > 0) await expect(projectSelect).toHaveValue(project.id);
  await page.getByLabel('需求').fill(requirement);
  await page.getByRole('button', { name: /^开始/ }).click();
  // Starting creates the task's worktree first (up to 9 s on the Windows runner).
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });
}
