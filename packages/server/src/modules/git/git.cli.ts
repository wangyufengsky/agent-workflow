import { AppError, ErrorCode } from '@aw/shared';
import { execa } from 'execa';

export type GitOptions = {
  cwd: string;
  /** Exit codes that are answers rather than failures (e.g. 1 from `symbolic-ref --quiet`). Default [0]. */
  okExitCodes?: readonly number[];
  /** Environment for locating git; defaults to the process environment. */
  env?: NodeJS.ProcessEnv;
};

export type GitResult = { stdout: string; exitCode: number };

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
  });
  if (result.code === 'ENOENT' && result.exitCode === undefined) {
    throw new AppError(ErrorCode.GitNotInstalled, 'git executable not found');
  }
  const exitCode = result.exitCode ?? -1;
  if (!(options.okExitCodes ?? [0]).includes(exitCode)) {
    throw new AppError(ErrorCode.GitCommandFailed, `git ${args[0]} failed`, {
      args: [...args],
      exitCode,
      stderr: result.stderr,
    });
  }
  return { stdout: result.stdout, exitCode };
}
