import { AppError, type CommitIdentity, ErrorCode, GIT_COMMIT_IDENTITY } from '@aw/shared';
import { execa } from 'execa';
import { host } from '../../core/platform.ts';

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
 * The only way to run git (06 §2.3): argument array, `LC_ALL=C` so output is parseable (D37), the platform's
 * options (D71),
 * missing binary → GIT_NOT_INSTALLED, unexpected exit → GIT_COMMAND_FAILED with args, exit code and stderr.
 */
export async function runGit(args: readonly string[], options: GitOptions): Promise<GitResult> {
  const env = options.env ?? process.env;
  // Located here rather than by spawning: on Windows execa runs an unresolvable command through cmd.exe, which
  // exits 1 instead of reporting ENOENT.
  const git = host.findExecutable('git', host.pathDirs(env));
  if (git === undefined) throw new AppError(ErrorCode.GitNotInstalled, 'git executable not found');
  const result = await execa(git, [...host.gitPlatformArgs, ...args], {
    cwd: options.cwd,
    env: { ...env, LC_ALL: 'C' },
    extendEnv: false,
    reject: false,
    stripFinalNewline: options.verbatim !== true,
  });
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
 * Commits made by the backend (node commits, merges, rebases) use agent-workflow's identity, or the one set in
 * `git.commitIdentity` (D227), without the user's signing setup (D48); prepend to the git arguments.
 */
export function backendCommitter(identity: CommitIdentity | null = null): readonly string[] {
  const { name, email } = identity ?? GIT_COMMIT_IDENTITY;
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false'];
}
