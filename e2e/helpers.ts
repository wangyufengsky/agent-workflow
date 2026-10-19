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
