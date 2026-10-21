import { tmpdir } from 'node:os';
import { AppError, ErrorCode } from '@aw/shared';
import { host } from '../../core/platform.ts';
import { runGit } from './git.cli.ts';

/** `git --version` → `2.45.2`; GIT_NOT_INSTALLED when missing. */
export async function readGitVersion(env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await runGit(['--version'], { cwd: tmpdir(), ...(env === undefined ? {} : { env }) });
  const match = /^git version (\S+)/.exec(stdout);
  if (match?.[1] === undefined) {
    throw new AppError(ErrorCode.GitCommandFailed, 'Unexpected git --version output', { stdout });
  }
  return match[1];
}

/** Repository root containing `dir` (symlinks resolved, native form), or undefined when `dir` is not in a work tree. */
export async function readRepoRoot(dir: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir, okExitCodes: [0, 128] });
  return exitCode === 0 ? host.fromGitPath(stdout.trim()) : undefined;
}

/** The remote's default branch when known (`origin/HEAD`), otherwise the checked-out branch; undefined if detached. */
export async function readDefaultBranch(repo: string): Promise<string | undefined> {
  const remoteHead = await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: repo,
    okExitCodes: [0, 1, 128],
  });
  if (remoteHead.exitCode === 0) return remoteHead.stdout.trim().replace(/^origin\//, '');
  const head = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repo, okExitCodes: [0, 1] });
  return head.exitCode === 0 ? head.stdout.trim() : undefined;
}

/** URL of `origin`, or undefined when the repository has no such remote (exit 2). */
export async function readOriginUrl(repo: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(['remote', 'get-url', 'origin'], { cwd: repo, okExitCodes: [0, 2] });
  return exitCode === 0 ? stdout.trim() : undefined;
}

/** Checked-out branch (undefined when HEAD is detached) and the commit HEAD points at. */
export async function readHead(repo: string): Promise<{ branch: string | undefined; commit: string }> {
  const [branch, commit] = await Promise.all([
    runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repo, okExitCodes: [0, 1] }),
    runGit(['rev-parse', 'HEAD'], { cwd: repo }),
  ]);
  return { branch: branch.exitCode === 0 ? branch.stdout.trim() : undefined, commit: commit.stdout.trim() };
}

/** Whether a local branch exists. */
export async function branchExists(repo: string, branch: string): Promise<boolean> {
  const { exitCode } = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repo,
    okExitCodes: [0, 1],
  });
  return exitCode === 0;
}
