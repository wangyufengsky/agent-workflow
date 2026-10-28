import { AppError, ErrorCode } from '@aw/shared';
import { runGit } from './git.cli.ts';

/**
 * What reaching remotes over HTTPS takes besides the user's own git configuration (D175): `-c` settings, passed in the
 * environment, and variables.
 */
export type GitNetwork = { config: ReadonlyArray<readonly [string, string]>; env: NodeJS.ProcessEnv };

/**
 * Environment for talking to a remote: the app's CA and proxy (`network`), and with the project's token (D53) an extra
 * header git sends over HTTPS. They travel in the environment, never in the arguments (which are logged), and win over
 * the user's configuration. Without a token, and over SSH, git uses the user's own keys and credential helpers. Never
 * wait for a password prompt nobody can answer.
 */
export function originEnv(network: GitNetwork, authorization?: string): NodeJS.ProcessEnv {
  const config = [
    ...network.config,
    ...(authorization === undefined ? [] : [['http.extraHeader', `Authorization: ${authorization}`] as const]),
  ];
  return {
    ...process.env,
    ...network.env,
    ...(config.length === 0 ? {} : { GIT_CONFIG_PARAMETERS: configParameters(config) }),
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * `-c` settings the way git hands them to its own child processes, which every git version reads (`GIT_CONFIG_COUNT`
 * needs git 2.31, D225): `'key=value'` entries quoted as for a shell, separated by spaces.
 */
function configParameters(config: ReadonlyArray<readonly [string, string]>): string {
  return config.map(([key, value]) => `'${`${key}=${value}`.replaceAll("'", "'\\''")}'`).join(' ');
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
