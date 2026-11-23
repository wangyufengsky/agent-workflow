import {
  defaultProjectModuleOp,
  getProjectModulesOp,
  type ProjectModuleRun,
  type ProjectModules,
  rediscoverProjectModulesOp,
  startProjectModuleRunOp,
  stopProjectModuleRunOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { callOperation } from '../../../api/client.ts';

export const activeModuleRun = (run: ProjectModuleRun) =>
  run.status === 'starting' || run.status === 'running' || (run.status === 'ready' && run.finishedAt === null);

const POLL_INTERVAL_MS = 1000;

export function useProjectModules(id: string, branch: string) {
  const client = useQueryClient();
  const queryKey = ['project-modules', id, branch];
  const query = useQuery({
    queryKey,
    queryFn: () => callOperation(getProjectModulesOp, { id }),
    refetchInterval: ({ state }) => (state.data?.runs.some(activeModuleRun) ? POLL_INTERVAL_MS : false),
  });
  const cancelSnapshot = () => client.cancelQueries({ queryKey, exact: true });
  const storeSnapshot = async (snapshot: ProjectModules) => {
    // 操作回执发生在在途轮询之后，旧快照不能覆盖已经返回的启停状态。
    await cancelSnapshot();
    client.setQueryData(queryKey, snapshot);
  };
  const storeRun = async (run: ProjectModuleRun) => {
    await cancelSnapshot();
    client.setQueryData<ProjectModules>(queryKey, (snapshot) =>
      snapshot === undefined
        ? snapshot
        : { ...snapshot, runs: [run, ...snapshot.runs.filter(({ id }) => id !== run.id)] },
    );
  };
  const rediscover = useMutation({
    mutationFn: () => callOperation(rediscoverProjectModulesOp, { id }),
    onSuccess: storeSnapshot,
  });
  const setDefault = useMutation({
    mutationFn: (input: { moduleId: string; configurationId: string; fingerprint: string }) =>
      callOperation(defaultProjectModuleOp, { id, ...input }),
    onSuccess: storeSnapshot,
  });
  const start = useMutation({
    mutationFn: (input: Omit<z.input<typeof startProjectModuleRunOp.input>, 'id'>) =>
      callOperation(startProjectModuleRunOp, { id, ...input }),
    onSuccess: storeRun,
  });
  const stop = useMutation({
    mutationFn: (runId: string) => callOperation(stopProjectModuleRunOp, { id, runId }),
    onSuccess: storeRun,
  });
  return { query, rediscover, setDefault, start, stop };
}
