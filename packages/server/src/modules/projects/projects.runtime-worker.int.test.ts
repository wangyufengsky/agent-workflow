import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRuntimeCheckSchema } from '@aw/shared';
import { execa } from 'execa';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { systemClock } from '../../core/clock.ts';
import { createRepoLocks } from '../git/index.ts';
import { type RuntimeWorkerInput, runProjectRuntimeCheck } from './projects.runtime-worker.ts';

let root: string;
let repo: string;
const git = (...args: string[]) => execa('git', args, { cwd: repo });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aw-runtime-test-'));
  repo = join(root, 'repo');
  await mkdir(join(root, 'workspace'));
  await execa('git', ['init', '-b', 'main', repo]);
  await writeFile(join(repo, 'file.txt'), 'original');
  await git('add', '.');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial');
});
afterEach(async () => rm(root, { recursive: true, force: true }));

function input(): RuntimeWorkerInput {
  return {
    repoPath: repo,
    workspaceRoot: join(root, 'workspace'),
    branch: 'main',
    checkCommand: null,
    preview: null,
    signal: new AbortController().signal,
    env: process.env,
    clock: systemClock,
    locks: createRepoLocks(),
    runCommand: async () => ({ passed: true, output: '', unrunnable: null, timedOut: false }),
  };
}

it('uses a detached worktree and removes it without changing the main checkout', async () => {
  const options = input();
  options.checkCommand = 'configured command';
  options.runCommand = async (directory) => {
    await writeFile(join(directory, 'file.txt'), 'changed');
    return { passed: true, output: '', unrunnable: null, timedOut: false };
  };
  const result = await runProjectRuntimeCheck(options);
  expect(result.repository.status).toBe('passed');
  expect(result.command.status).toBe('passed');
  expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('original');
  expect((await git('worktree', 'list', '--porcelain')).stdout.match(/^worktree /gm)).toHaveLength(1);
});

it('reports an invalid branch without running commands or leaving a worktree', async () => {
  const options = input();
  options.branch = 'missing';
  options.checkCommand = 'configured command';
  options.runCommand = () => {
    throw new Error('must not run');
  };
  const result = await runProjectRuntimeCheck(options);
  expect(result.repository.status).toBe('failed');
  expect(result.command.status).toBe('skipped');
  expect((await git('worktree', 'list', '--porcelain')).stdout.match(/^worktree /gm)).toHaveLength(1);
});

it('exposes a typed timeout separately from a nonzero exit', async () => {
  const options = input();
  options.checkCommand = 'configured command';
  options.runCommand = async () => ({ passed: false, output: 'late', unrunnable: null, timedOut: true });
  const result = await runProjectRuntimeCheck(options);
  expect(result.command).toMatchObject({ status: 'failed', reason: 'timeout', output: 'late' });
});

it('accepts results saved before failure reasons and infrastructure diagnostics existed', () => {
  const part = { status: 'failed', output: 'old output' };
  const result = projectRuntimeCheckSchema.parse({
    projectId: 'old',
    branch: 'main',
    configVersion: 1,
    checkCommand: null,
    preview: null,
    startedAt: 1,
    finishedAt: 2,
    status: 'completed',
    repository: part,
    command: part,
    previewResult: part,
  });
  expect(result.command.reason).toBeUndefined();
  expect(result.infrastructureError).toBeUndefined();
});
