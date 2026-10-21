import {
  INSIGHTS_DIMENSIONS,
  type InsightsDimension,
  InsightsDrill,
  type InsightsSummaryDTO,
  type InsightsTaskDTO,
} from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import {
  INSIGHTS_COPY as C,
  drillLabel,
  failureName,
  formatDuration,
  formatTokens,
  groupName,
} from '../../copy/insights.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { CostValue } from './cost-value.tsx';
import { drillFilter, failureKey } from './drill.ts';
import styles from './insights.module.css';

const isDimension = (drill: InsightsDrill): drill is InsightsDimension => INSIGHTS_DIMENSIONS.some((d) => d === drill);

/** The name a group or failure reason drill-down is about, from the figures it was opened from. */
function drilledName(drill: InsightsDrill, key: string | null, summary: InsightsSummaryDTO): string {
  if (drill === InsightsDrill.Failure) {
    const reason = summary.quality.failureReasons.find((r) => failureKey(r) === key);
    return reason === undefined ? '' : failureName(reason);
  }
  if (!isDimension(drill)) return '';
  const group = summary.usage.groups[drill].find((g) => g.key === key);
  return group === undefined ? '' : groupName(drill, group.key, group.name);
}

/** The tasks of the period (19 §3.2), all of them or those behind the figure drilled into. */
export function InsightsTaskTable({
  rows,
  summary,
  drill,
  drillKey,
  onClear,
}: {
  rows: readonly InsightsTaskDTO[];
  summary: InsightsSummaryDTO;
  drill: InsightsDrill | undefined;
  drillKey: string | null;
  onClear: () => void;
}) {
  const shown = drill === undefined ? rows : rows.filter(drillFilter(drill, drillKey));
  const tokens = (r: InsightsTaskDTO) => r.usage.tokensInput + r.usage.tokensOutput;
  const most = Math.max(1, ...shown.map(tokens));
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title grow">{C.tasksTitle}</h2>
        <span className="hint">{C.tasksLede}</span>
      </div>
      {drill !== undefined && (
        <div className={styles.drilling} data-testid="insights-drill">
          <span className="grow">{C.drilling(drillLabel(drill, drilledName(drill, drillKey, summary)))}</span>
          <Button size="sm" variant="ghost" onClick={onClear}>
            {C.clearDrill}
          </Button>
        </div>
      )}
      <div className="card-body">
        {shown.length === 0 ? (
          <p className="hint">{C.noTasks}</p>
        ) : (
          <table className={styles.table} data-testid="insights-tasks">
            <thead>
              <tr>
                <th>{C.columns.task}</th>
                <th>{C.columns.project}</th>
                <th>{C.columns.status}</th>
                <th className={styles.num}>{C.columns.tokens}</th>
                <th className={styles.num}>{C.columns.cost}</th>
                <th className={styles.num}>{C.columns.retries}</th>
                <th className={styles.num}>{C.columns.interruptions}</th>
                <th className={styles.num}>{C.columns.reviewDuration}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.task.id}>
                  <td>
                    <Link to={ROUTES.task} params={{ taskId: row.task.id }} search={{}}>
                      <span className="mono hint">{row.task.key}</span> {row.task.title}
                    </Link>
                  </td>
                  <td>{row.task.project.name}</td>
                  <td>
                    <TaskBadge group={row.task.displayGroup} />
                  </td>
                  <td className={styles.num}>
                    <span className={styles.barCell}>
                      <span className={styles.barTrack} aria-hidden="true">
                        <i style={{ width: `${(tokens(row) / most) * 100}%` }} />
                      </span>
                      {formatTokens(tokens(row))}
                    </span>
                  </td>
                  <td className={styles.num}>
                    <CostValue usage={row.usage} />
                  </td>
                  <td className={styles.num}>{row.quality === null ? C.dash : row.quality.retries}</td>
                  <td className={styles.num}>{row.quality === null ? C.dash : row.quality.interruptions}</td>
                  <td className={styles.num}>
                    {row.quality === null ? C.dash : formatDuration(row.quality.reviewDurationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
