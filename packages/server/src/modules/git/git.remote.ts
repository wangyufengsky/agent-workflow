import { AppError, ErrorCode } from '@aw/shared';
import { runGit } from './git.cli.ts';

/**
 * Environment for talking to `origin`. With the project's token (D53) git sends it as an extra header over HTTPS; it
 * travels in the environment, never in the arguments (which are logged). Without one, and over SSH, git uses the
 * user's own keys and credential helpers. Never wait for a password prompt nobody can answer.
 */
export function originEnv(authorization: string | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(authorization === undefined
      ? {}
      : {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.extraHeader',
          GIT_CONFIG_VALUE_0: `Authorization: ${authorization}`,
        }),
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** `git push --porcelain`: one `<flag>\t<from>:<to>\t<summary>` line per ref; `!` means the remote rejected it. */
export function isPushRejected(output: string): boolean {
  return output.split('\n').some((line) => line.startsWith('!\t'));
}

/**
 * Pushes a local branch to `origin` under the same name, never forced; `setUpstream` makes `origin/<branch>` its
 * upstream. A rejection (the remote has commits this branch lacks) is GIT_PUSH_REJECTED.
 */
export async function pushToOrigin(
  cwd: string,
  branch: string,
  options: { env: NodeJS.ProcessEnv; setUpstream: boolean },
): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const args = ['push', '--porcelain', ...(options.setUpstream ? ['--set-upstream'] : []), 'origin', `${ref}:${ref}`];
  const result = await runGit(args, { cwd, env: options.env, okExitCodes: [0, 1] });
  if (result.exitCode === 0) return;
  if (isPushRejected(result.stdout)) {
    throw new AppError(ErrorCode.GitPushRejected, 'The remote branch has commits this branch lacks', { branch });
  }
  throw new AppError(ErrorCode.GitCommandFailed, 'git push failed', {
    args,
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

/** Fetches one remote; changes refs (lock the repository). */
export async function fetchRemote(cwd: string, remote: string, env: NodeJS.ProcessEnv): Promise<void> {
  await runGit(['fetch', '--quiet', '--prune', '--', remote], { cwd, env });
}
