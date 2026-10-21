import { type FailureReasonDTO, InsightsDrill, type InsightsTaskDTO } from '@aw/shared';

/** Opens the tasks behind a metric; `key` names the group or failure reason. */
export type Drill = (drill: InsightsDrill, key: string | null) => void;

/** A failure reason as the `key` of the `failure` drill-down. */
export const failureKey = (reason: Pick<FailureReasonDTO, 'kind' | 'code'>) => `${reason.kind}:${reason.code ?? ''}`;

/**
 * The tasks a metric is about (19 §3.2). Dimension drill-downs take the group's key; null is the group without one
 * (opencode's default model).
 */
export function drillFilter(drill: InsightsDrill, key: string | null): (row: InsightsTaskDTO) => boolean {
  switch (drill) {
    case InsightsDrill.Completed:
    case InsightsDrill.Cancelled:
    case InsightsDrill.Failed:
      return (row) => row.quality !== null && row.task.status === drill;
    case InsightsDrill.FirstPassMissed:
      return ({ quality: q }) => q !== null && q.firstPassNodes < q.doneNodes;
    case InsightsDrill.Retried:
      return ({ quality: q }) => q !== null && q.retries > 0;
    case InsightsDrill.Interrupted:
      return ({ quality: q }) => q !== null && q.interruptions > 0;
    case InsightsDrill.ReviewDuration:
      return ({ quality: q }) => q !== null && q.reviewDurationMs !== null;
    case InsightsDrill.Failure:
      return ({ quality: q }) => q?.failureReasons.some((r) => failureKey(r) === key) === true;
    case InsightsDrill.Project:
      return (row) => row.usage.attempts > 0 && row.task.project.id === key;
    case InsightsDrill.Workflow:
      return (row) => row.usage.attempts > 0 && row.task.workflow.key === key;
    case InsightsDrill.Role:
      return (row) => key !== null && row.roles.includes(key);
    case InsightsDrill.Model:
      return (row) => row.models.includes(key);
    case InsightsDrill.Kind:
      return (row) => row.kinds.some((kind) => kind === key);
  }
}
