import { AppError, ErrorCode, GIT_COMMIT_IDENTITY } from '@aw/shared';
import { execa } from 'execa';

export type GitOptions = {
  cwd: string;
  /** Exit codes that are answers rather than failures (e.g. 1 from `symbolic-ref --quiet`). Default [0]. */
  okExitCodes?: readonly number[];
  /** Environment for locating git; defaults to the process environment. */
  env?: NodeJS.ProcessEnv;
  /** Keep stdout exactly as written (file contents and diffs end with their own newline). */
  verbatim?: boolean;
};

export type GitResult = { stdout: string; stderr: string; exitCode: number };

/**
 * The only way to run git (06 §2.3): argument array, `LC_ALL=C` so output is parseable (D37),
 * missing binary → GIT_NOT_INSTALLED, unexpected exit → GIT_COMMAND_FAILED with args, exit code and stderr.
 */
export async function runGit(args: readonly string[], options: GitOptions): Promise<GitResult> {
  const result = await execa('git', args, {
    cwd: options.cwd,
    env: { ...(options.env ?? process.env), LC_ALL: 'C' },
    extendEnv: false,
    reject: false,
    stripFinalNewline: options.verbatim !== true,
  });
  if (result.code === 'ENOENT' && result.exitCode === undefined) {
    throw new AppError(ErrorCode.GitNotInstalled, 'git executable not found');
  }
  // No exit code means git was killed by a signal; report it as a failure like any unexpected exit.
  const exitCode = result.exitCode ?? -1;
  if (!(options.okExitCodes ?? [0]).includes(exitCode)) {
    throw new AppError(ErrorCode.GitCommandFailed, `git ${args[0]} failed`, {
      args: [...args],
      exitCode,
      stderr: result.stderr,
    });
  }
  return { stdout: result.stdout, stderr: result.stderr, exitCode };
}

/** The failure of a command whose exit code was accepted but turned out not to be an answer. */
export function gitFailure(args: readonly string[], result: GitResult): AppError {
  return new AppError(ErrorCode.GitCommandFailed, `git ${args[0]} failed`, {
    args: [...args],
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

/**
 * Commits made by the backend (node commits, merges, rebases) use agent-workflow's identity, without the user's
 * signing setup (D48); prepend to the git arguments.
 */
export const BACKEND_COMMITTER = [
  '-c',
  `user.name=${GIT_COMMIT_IDENTITY.name}`,
  '-c',
  `user.email=${GIT_COMMIT_IDENTITY.email}`,
  '-c',
  'commit.gpgsign=false',
] as const;
