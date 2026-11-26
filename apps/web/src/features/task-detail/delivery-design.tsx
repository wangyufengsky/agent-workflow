import {
  type DeliveryDTO,
  DesignKnowledgeMatch,
  DesignStalenessState,
  DesignStatus,
  GitImpactTargetKind,
  isLocalMerge,
  listDesignsOp,
  type TaskDetailDTO,
  taskDesignImpactOp,
  WorkflowDeliverable,
  WorktreeStatus,
} from '@aw/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { DELIVERY_COPY as C } from '../../copy/delivery.ts';
import { designStalenessQuery } from '../designs/designs.queries.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import styles from './task-page.module.css';

const impactQuery = (id: string, updatedAt: number) =>
  queryOptions({
    queryKey: [...queryKeys.designs, 'task-impact', id, updatedAt],
    queryFn: () => callOperation(taskDesignImpactOp, { id }),
  });

export function DeliveryDesignImpact({ task }: { task: TaskDetailDTO }) {
  const impact = useQuery({
    ...impactQuery(task.id, task.updatedAt),
    enabled: task.git.worktreeStatus === WorktreeStatus.Ready && (task.result?.filesChanged ?? 0) > 0,
  });

  if (impact.isError) return <ErrorState error={impact.error} onRetry={() => void impact.refetch()} />;
  if (impact.data == null) return null;
  const { candidates, match, moduleCount, transactionCount, designId, uncoveredPaths, truncated } = impact.data;
  const nodes = candidates.filter(
    ({ targetKind }) =>
      targetKind === GitImpactTargetKind.Section ||
      targetKind === GitImpactTargetKind.Submodule ||
      targetKind === GitImpactTargetKind.Transaction,
  );
  return (
    <details className={`card ${styles.deliveryDesign}`}>
      <summary>{C.designImpact(moduleCount, transactionCount, match === DesignKnowledgeMatch.Exact)}</summary>
      {uncoveredPaths.length > 0 && <p className="hint">{C.designUncovered(uncoveredPaths.length)}</p>}
      {truncated && <p className="hint">{C.designTruncated}</p>}
      {nodes.length > 0 && (
        <ul>
          {nodes.map(({ title, targetKind, targetId }) => (
            <li key={`${targetKind}:${targetId}`}>
              <Link
                className="link"
                to={ROUTES.designWorkbench}
                params={{ designId }}
                search={{ targetKind, targetId }}
              >
                {title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const readyDesignQuery = (projectId: string, deliveryId: string) =>
  queryOptions({
    queryKey: [...queryKeys.designs, 'delivery-ready', projectId, deliveryId],
    queryFn: async () => {
      let cursor: string | undefined;
      do {
        const page = await callOperation(listDesignsOp, { projectId, cursor });
        const ready = page.items.find(({ status }) => status === DesignStatus.Ready);
        if (ready !== undefined) return ready.id;
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return null;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

/** 以本次交付为缓存范围，避免切换视图时重复读取，也避免用到合并前的快照对比。 */
function MergedDesignNotice({
  deliveryId,
  designId,
  targetBranch,
  commitSha,
}: {
  deliveryId: string;
  designId: string;
  targetBranch: string;
  commitSha?: string | undefined;
}) {
  const options = designStalenessQuery(designId, commitSha);
  const staleness = useQuery({
    ...options,
    queryKey: [...options.queryKey, 'delivery', deliveryId],
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (staleness.isError) return <ErrorState error={staleness.error} onRetry={() => void staleness.refetch()} />;
  if (staleness.data?.state !== DesignStalenessState.Stale) return null;
  return (
    <p className="row wrap" role="status">
      {C.designStale(
        staleness.data.changedFilesCount,
        staleness.data.affectedSectionIds.length,
        commitSha !== undefined,
      )}
      <Link className="link" to={ROUTES.designWorkbench} params={{ designId }}>
        {commitSha === undefined ? C.openDesignUpdate : C.openDesign}
      </Link>
      {commitSha !== undefined && <span className="hint">{C.switchBranchToUpdate(targetBranch)}</span>}
    </p>
  );
}

function LocalDeliveryDesignNotice({
  projectId,
  delivery,
  commitSha,
}: {
  projectId: string;
  delivery: DeliveryDTO;
  commitSha: string;
}) {
  const projectQueryResult = useQuery(projectQuery(projectId));
  const project = projectQueryResult.data;
  const isDefaultDelivery = project !== undefined && delivery.targetBranch === project.defaultBranch;
  const design = useQuery({
    ...readyDesignQuery(projectId, delivery.id),
    enabled: isDefaultDelivery,
  });
  if (projectQueryResult.isError) {
    return <ErrorState error={projectQueryResult.error} onRetry={() => void projectQueryResult.refetch()} />;
  }
  if (!isDefaultDelivery) return null;
  if (design.isError) return <ErrorState error={design.error} onRetry={() => void design.refetch()} />;
  if (design.data == null || projectQueryResult.isFetching) return null;
  return (
    <MergedDesignNotice
      deliveryId={delivery.id}
      designId={design.data}
      targetBranch={delivery.targetBranch}
      commitSha={project.currentBranch === project.defaultBranch ? undefined : commitSha}
    />
  );
}

export function DeliveryDesignNotice({ task, delivery }: { task: TaskDetailDTO; delivery: DeliveryDTO }) {
  if (
    task.workflow.deliverable === WorkflowDeliverable.Report ||
    delivery.commitSha === null ||
    !isLocalMerge(delivery.strategy)
  ) {
    return null;
  }
  return <LocalDeliveryDesignNotice projectId={task.project.id} delivery={delivery} commitSha={delivery.commitSha} />;
}
