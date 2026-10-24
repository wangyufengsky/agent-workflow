import {
  type GitReviewTargetInput,
  getGitReviewOp,
  gitBranchesOp,
  gitChangeFileOp,
  gitChangesOp,
  gitCommitOp,
  gitCreateBranchOp,
  gitCreateCommitOp,
  gitCreatePullRequestOp,
  gitDeleteBranchOp,
  gitDiffFileOp,
  gitDiffOp,
  gitDraftCommitMessageOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitMergeOp,
  gitMergeWithAiOp,
  gitPullOp,
  gitPushOp,
  gitPushPreviewOp,
  gitStageOp,
  gitStatusOp,
  gitSwitchBranchOp,
  gitTreeOp,
  gitUnstageOp,
  listGitReviewsOp,
  listWorktreesOp,
  pruneWorktreesOp,
  startGitReviewOp,
  stopGitReviewOp,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import type { FileDiffQuery } from '../../components/diff/diff-browser.tsx';

const key = queryKeys.gitResource;

/** Commits of one page of the log. */
export const LOG_PAGE = 50;

export const gitStatusQuery = (id: string) =>
  queryOptions({
    queryKey: key(id, 'status', {}),
    queryFn: () => callOperation(gitStatusOp, { id }),
  });

export const gitBranchesQuery = (id: string) =>
  queryOptions({
    queryKey: key(id, 'branches', {}),
    queryFn: async () => (await callOperation(gitBranchesOp, { id })).items,
  });

export type LogFilter = { author?: string | undefined; search?: string | undefined };

export const gitLogQuery = (id: string, ref: string, filter: LogFilter = {}) =>
  infiniteQueryOptions({
    queryKey: key(id, 'log', { ref, author: filter.author, search: filter.search }),
    queryFn: ({ pageParam }) => callOperation(gitLogOp, { id, ref, limit: LOG_PAGE, cursor: pageParam, ...filter }),
    // The cursor counts the commits already shown.
    initialPageParam: '0',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** The newest commit of a ref, for the overview cards. */
export const gitLastCommitQuery = (id: string, ref: string) =>
  queryOptions({
    queryKey: key(id, 'last', { ref }),
    queryFn: async () => (await callOperation(gitLogOp, { id, ref, limit: 1 })).items[0] ?? null,
  });

/** The commit `ref` was at when `before` (ms) came, on its own first-parent history; null if it had none (27 §4.2). */
export const gitCommitBeforeQuery = (id: string, ref: string, before: number) =>
  queryOptions({
    queryKey: key(id, 'before', { ref, before }),
    queryFn: async () => (await callOperation(gitLogOp, { id, ref, limit: 1, before })).items[0] ?? null,
  });

export const gitCommitQuery = (id: string, sha: string, parent: number | undefined) =>
  queryOptions({
    queryKey: key(id, 'commit', { sha, parent }),
    queryFn: () => callOperation(gitCommitOp, { id, sha, parent }),
  });

export const gitDiffQuery = (id: string, from: string, to: string) =>
  queryOptions({ queryKey: key(id, 'diff', { from, to }), queryFn: () => callOperation(gitDiffOp, { id, from, to }) });

export const gitDiffFileQuery =
  (id: string, from: string, to: string): FileDiffQuery =>
  (path) => ({
    queryKey: key(id, 'diffFile', { from, to, path }),
    queryFn: () => callOperation(gitDiffFileOp, { id, from, to, path }),
  });

export const gitChangesQuery = (id: string) =>
  queryOptions({
    queryKey: key(id, 'changes', {}),
    queryFn: () => callOperation(gitChangesOp, { id }),
  });

export const gitChangeFileQuery =
  (id: string, side: 'staged' | 'unstaged'): FileDiffQuery =>
  (path) => ({
    queryKey: key(id, 'changeFile', { side, path }),
    queryFn: () => callOperation(gitChangeFileOp, { id, path, side }),
  });

export const gitTreeQuery = (id: string, ref: string, path: string) =>
  queryOptions({
    queryKey: key(id, 'tree', { ref, path }),
    queryFn: async () => (await callOperation(gitTreeOp, { id, ref, path })).items,
  });

export const gitFileQuery = (id: string, ref: string, path: string) =>
  queryOptions({
    queryKey: key(id, 'file', { ref, path }),
    queryFn: () => callOperation(gitFileOp, { id, ref, path }),
  });

export const worktreesQuery = (id: string) =>
  queryOptions({
    queryKey: key(id, 'worktrees', {}),
    queryFn: async () => (await callOperation(listWorktreesOp, { id })).items,
  });

export const gitPushPreviewQuery = (id: string, branch: string) =>
  queryOptions({
    queryKey: key(id, 'pushPreview', { branch }),
    queryFn: () => callOperation(gitPushPreviewOp, { id, branch }),
  });

/** Reviews of the project, newest first; `to` limits them to one commit's. */
export const gitReviewsQuery = (id: string, to?: string) =>
  queryOptions({
    queryKey: key(id, 'reviews', { to }),
    queryFn: async () => (await callOperation(listGitReviewsOp, { id, to })).items,
  });

export const gitReviewQuery = (reviewId: string) =>
  queryOptions({
    queryKey: queryKeys.gitReview(reviewId),
    queryFn: () => callOperation(getGitReviewOp, { reviewId }),
  });

/** A review started, submitted or ended (27 §7.4): its project's lists and the review itself. */
export async function refreshGitReview(qc: QueryClient, projectId: string, reviewId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: [...queryKeys.git(projectId), 'reviews'] }),
    qc.invalidateQueries({ queryKey: queryKeys.gitReview(reviewId) }),
  ]);
}

/**
 * The main worktree changes outside the app too (the user's editor, a terminal) with no event to say so: when the
 * window comes back into focus the workbench reads the repository again. Switching to another application does not
 * change the page's visibility, so this listens to the window's focus rather than using the query's focus refetch.
 */
export function useRefreshOnFocus(projectId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.git(projectId) });
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [queryClient, projectId]);
}

/**
 * A mutation of the repository: afterwards everything read from it may have changed, so the project's whole Git
 * cache is read again.
 */
function useGitMutation<I, O>(projectId: string, mutationFn: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.git(projectId) }),
  });
}

export const useFetch = (id: string) => useGitMutation(id, () => callOperation(gitFetchOp, { id }));
export const usePull = (id: string) => useGitMutation(id, () => callOperation(gitPullOp, { id }));
export const useStage = (id: string) =>
  useGitMutation(id, (paths: string[]) => callOperation(gitStageOp, { id, paths }));
export const useUnstage = (id: string) =>
  useGitMutation(id, (paths: string[]) => callOperation(gitUnstageOp, { id, paths }));
export const useCommit = (id: string) =>
  useGitMutation(id, (message: string) => callOperation(gitCreateCommitOp, { id, message }));
export const usePush = (id: string) => useGitMutation(id, (branch: string) => callOperation(gitPushOp, { id, branch }));
export const useCreateBranch = (id: string) =>
  useGitMutation(id, (input: { name: string; startPoint: string; switch: boolean }) =>
    callOperation(gitCreateBranchOp, { id, ...input }),
  );
export const useSwitchBranch = (id: string) =>
  useGitMutation(id, (branch: string) => callOperation(gitSwitchBranchOp, { id, branch }));
export const useDeleteBranch = (id: string) =>
  useGitMutation(id, (input: { name: string; force: boolean }) => callOperation(gitDeleteBranchOp, { id, ...input }));
export const useMerge = (id: string) =>
  useGitMutation(id, (input: { source: string; target: string; strategy: 'merge' | 'squash'; message: string }) =>
    callOperation(gitMergeOp, { id, ...input }),
  );
export const useMergeWithAi = (id: string) =>
  useGitMutation(id, (input: { source: string; target: string }) => callOperation(gitMergeWithAiOp, { id, ...input }));
export const useCreatePullRequest = (id: string) =>
  useGitMutation(id, (input: { branch: string; base: string; title: string; body: string }) =>
    callOperation(gitCreatePullRequestOp, { id, ...input }),
  );
export const usePruneWorktrees = (id: string) => useGitMutation(id, () => callOperation(pruneWorktreesOp, { id }));

/** Asks the AI for a commit message: the staged changes, or squashing `from` into `to` (27 §7.3). */
export function useDraftCommitMessage(id: string) {
  return useMutation({
    mutationFn: (range?: { from: string; to: string }) => callOperation(gitDraftCommitMessageOp, { id, ...range }),
  });
}

export function useStartReview(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { target: GitReviewTargetInput; focus?: string }) =>
      callOperation(startGitReviewOp, { id, ...input }),
    onSuccess: (review) => refreshGitReview(queryClient, id, review.id),
  });
}

export function useStopReview(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => callOperation(stopGitReviewOp, { reviewId }),
    onSuccess: (review) => refreshGitReview(queryClient, projectId, review.id),
  });
}
