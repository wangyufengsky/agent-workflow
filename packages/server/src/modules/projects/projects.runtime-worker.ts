import { realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, type ProjectPreview } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { listWorktrees, locateShell, type RepoLocks, runGit } from '../git/index.ts';
import { createPreviewLog, launchPreview, setUpPreview } from '../previews/index.ts';

export type RuntimePart = {
  status: 'pending' | 'passed' | 'failed' | 'not_configured' | 'stopped' | 'skipped';
  output: string;
  reason?: 'cannot_start' | 'timeout' | 'nonzero_exit' | 'execution_error';
};
export type RuntimeResults = { repository: RuntimePart; command: RuntimePart; preview: RuntimePart };
type CommandResult = { passed: boolean; output: string; unrunnable: unknown; timedOut: boolean };
export type RuntimeWorkerInput = {
  repoPath: string;
  workspaceRoot: string;
  branch: string;
  checkCommand: string | null;
  preview: ProjectPreview | null;
  signal: AbortSignal;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  locks: RepoLocks;
  runCommand(directory: string, command: string, signal: AbortSignal): Promise<CommandResult>;
  onProgress?(results: RuntimeResults): void;
};

export class RuntimeCleanupError extends Error {
  constructor(cause: unknown) {
    super(message(cause), { cause });
  }
}

const empty = (): RuntimePart => ({ status: 'not_configured', output: '' });
const message = (error: unknown) => {
  const description = error instanceof Error ? error.message : String(error);
  const stderr = error instanceof AppError && typeof error.details?.stderr === 'string' ? error.details.stderr : '';
  return stderr === '' ? description : `${description}\n${stderr.slice(-4000)}`;
};

/** Execute a configuration snapshot without altering the repository's checked-out files or creating a branch. */
export async function runProjectRuntimeCheck(input: RuntimeWorkerInput): Promise<RuntimeResults> {
  const waiting = (): RuntimePart => ({ status: 'pending', output: '' });
  const results: RuntimeResults = {
    repository: waiting(),
    command: input.checkCommand === null ? empty() : waiting(),
    preview: input.preview === null ? empty() : waiting(),
  };
  const publish = () => input.onProgress?.(structuredClone(results));
  const root = input.workspaceRoot;
  const directory = join(root, 'worktree');
  let attemptedAdd = false;
  try {
    if (input.signal.aborted) {
      results.repository = { status: 'stopped', output: '' };
      return results;
    }
    try {
      await input.locks.run(input.repoPath, async () => {
        // Resolve the commit before passing it to worktree add, so a branch cannot be interpreted as an option.
        await runGit(['check-ref-format', `refs/heads/${input.branch}`], { cwd: input.repoPath, env: input.env });
        const { stdout } = await runGit(
          ['rev-parse', '--verify', '--end-of-options', `refs/heads/${input.branch}^{commit}`],
          {
            cwd: input.repoPath,
            env: input.env,
          },
        );
        if (input.signal.aborted) return;
        attemptedAdd = true;
        await runGit(['worktree', 'add', '--detach', '--', directory, stdout.trim()], {
          cwd: input.repoPath,
          env: input.env,
        });
      });
      results.repository = { status: input.signal.aborted ? 'stopped' : 'passed', output: '' };
    } catch (error) {
      results.repository = { status: 'failed', output: message(error) };
      return results;
    } finally {
      publish();
    }
    if (input.signal.aborted) return results;
    if (input.checkCommand !== null) {
      try {
        const result = await input.runCommand(directory, input.checkCommand, input.signal);
        results.command = {
          status: input.signal.aborted ? 'stopped' : result.passed ? 'passed' : 'failed',
          output: result.output,
          ...(!input.signal.aborted && !result.passed
            ? {
                reason: result.timedOut
                  ? ('timeout' as const)
                  : result.unrunnable !== null
                    ? ('cannot_start' as const)
                    : ('nonzero_exit' as const),
              }
            : {}),
        };
      } catch (error) {
        results.command = {
          status: input.signal.aborted ? 'stopped' : 'failed',
          output: message(error),
          ...(input.signal.aborted ? {} : { reason: 'execution_error' }),
        };
      }
      publish();
    }
    if (input.signal.aborted) return results;
    if (input.preview !== null) {
      const log = createPreviewLog(null);
      try {
        const launch = {
          directory,
          config: input.preview,
          shell: await locateShell(input.env),
          env: input.env,
          clock: input.clock,
          log,
          signal: input.signal,
        };
        if (input.signal.aborted) throw new Error('Stopped while starting');
        if (input.preview.setupCommand !== null) await setUpPreview(input.preview.setupCommand, launch);
        const process = await launchPreview(launch);
        await process.stop();
        results.preview = { status: input.signal.aborted ? 'stopped' : 'passed', output: log.tail() };
      } catch (error) {
        results.preview = {
          status: input.signal.aborted ? 'stopped' : 'failed',
          output: `${message(error)}\n${log.tail()}`,
        };
      } finally {
        log.close();
        publish();
      }
    }
    return results;
  } finally {
    for (const part of [results.repository, results.command, results.preview]) {
      if (part.status === 'pending') part.status = input.signal.aborted ? 'stopped' : 'skipped';
    }
    try {
      publish();
    } finally {
      const cleanup = async () => {
        try {
          if (attemptedAdd) {
            await input.locks.run(input.repoPath, async () => {
              const worktrees = await listWorktrees(input.repoPath);
              const actual = await realpath(directory).catch(() => directory);
              const paths = await Promise.all(
                worktrees.map((worktree) => realpath(worktree.path).catch(() => worktree.path)),
              );
              if (paths.includes(actual))
                await runGit(['worktree', 'remove', '--force', '--', directory], {
                  cwd: input.repoPath,
                  env: input.env,
                });
            });
          }
          await rm(root, { recursive: true, force: true });
        } catch (error) {
          // Retain the journal for a later cleanup attempt.
          throw new RuntimeCleanupError(error);
        }
      };
      await cleanup();
    }
  }
}
