import { type RepoLocks, runGit } from '../git/index.ts';

/**
 * Pushes the task branch to `origin` for a pull request (09 §7), under the repository lock. Over HTTPS git sends the
 * project's token as an extra header; it travels in the environment, never in the arguments (which are logged).
 * Remotes over SSH use the user's own keys.
 */
export async function pushBranch(
  locks: RepoLocks,
  input: { repoPath: string; branch: string; authorization: string },
): Promise<void> {
  const ref = `refs/heads/${input.branch}`;
  await locks.run(input.repoPath, () =>
    runGit(['push', '--quiet', 'origin', `${ref}:${ref}`], {
      cwd: input.repoPath,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: ${input.authorization}`,
        // Never wait for a password prompt nobody can answer.
        GIT_TERMINAL_PROMPT: '0',
      },
    }),
  );
}
