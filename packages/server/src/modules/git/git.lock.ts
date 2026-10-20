/**
 * Serialises the git operations of one repository that change refs or its worktree list (D37: without it, concurrent
 * `git worktree add` corrupts worktree metadata). Operations on different repositories run in parallel.
 */
export function createRepoLocks() {
  /** Per repository: the end of its queue, which never rejects. */
  const tails = new Map<string, Promise<void>>();

  return {
    run<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
      const result = (tails.get(repoPath) ?? Promise.resolve()).then(operation);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(repoPath, tail);
      void tail.then(() => {
        if (tails.get(repoPath) === tail) tails.delete(repoPath);
      });
      return result;
    },
  };
}
export type RepoLocks = ReturnType<typeof createRepoLocks>;
