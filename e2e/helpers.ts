import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';

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
  | { type: 'callTool'; name: string; args: Record<string, unknown> }
  | { type: 'permission'; permission: string; patterns: string[] };

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
 * the directory keeps specs apart); `title` or `agent` narrow it to a step or the planner/reviewer.
 */
export async function queueTurn(
  request: APIRequestContext,
  project: E2EProject,
  match: { title?: string; agent?: string },
  steps: FakeStep[],
): Promise<void> {
  const res = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { ...match, directory: `/${project.slug}/` }, steps },
  });
  if (!res.ok()) throw new Error(`queueing a fake turn failed: ${res.status()} ${await res.text()}`);
}
