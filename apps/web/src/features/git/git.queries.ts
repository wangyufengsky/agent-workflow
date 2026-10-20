import {
  gitBranchesOp,
  gitCommitOp,
  gitDiffFileOp,
  gitDiffOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitStatusOp,
  gitTreeOp,
  listWorktreesOp,
  pruneWorktreesOp,
} from '@aw/shared';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import type { FileDiffQuery } from '../../components/diff/diff-browser.tsx';

const key = queryKeys.gitResource;

export const gitStatusQuery = (id: string) =>
  queryOptions({ queryKey: key(id, 'status', {}), queryFn: () => callOperation(gitStatusOp, { id }) });

export const gitBranchesQuery = (id: string) =>
  queryOptions({
    queryKey: key(id, 'branches', {}),
    queryFn: async () => (await callOperation(gitBranchesOp, { id })).items,
  });

export const gitLogQuery = (id: string, ref: string) =>
  infiniteQueryOptions({
    queryKey: key(id, 'log', { ref }),
    queryFn: ({ pageParam }) => callOperation(gitLogOp, { id, ref, cursor: pageParam }),
    // The cursor counts the commits already shown.
    initialPageParam: '0',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const gitCommitQuery = (id: string, sha: string) =>
  queryOptions({ queryKey: key(id, 'commit', { sha }), queryFn: () => callOperation(gitCommitOp, { id, sha }) });

export const gitDiffQuery = (id: string, from: string, to: string) =>
  queryOptions({ queryKey: key(id, 'diff', { from, to }), queryFn: () => callOperation(gitDiffOp, { id, from, to }) });

export const gitDiffFileQuery =
  (id: string, from: string, to: string): FileDiffQuery =>
  (path) => ({
    queryKey: key(id, 'diffFile', { from, to, path }),
    queryFn: () => callOperation(gitDiffFileOp, { id, from, to, path }),
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

/** Fetching changes every ref: the project's whole Git cache is refetched. */
export function useFetch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(gitFetchOp, { id }),
    onSuccess: (_r, id) => queryClient.invalidateQueries({ queryKey: queryKeys.git(id) }),
  });
}

export function usePruneWorktrees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(pruneWorktreesOp, { id }),
    onSuccess: async ({ items }, id) => {
      queryClient.setQueryData(key(id, 'worktrees', {}), items);
      await queryClient.invalidateQueries({ queryKey: queryKeys.git(id) });
    },
  });
}
