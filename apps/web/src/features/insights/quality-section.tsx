import { InsightsDrill, type InsightsSummaryDTO } from '@aw/shared';
import { INSIGHTS_COPY as C, failureName, formatAverage, formatDuration, formatPercent } from '../../copy/insights.ts';
import { type Drill, failureKey } from './drill.ts';
import styles from './insights.module.css';
import { StatCard } from './stat-card.tsx';

const ENDED = [
  [InsightsDrill.Completed, C.endedCompleted],
  [InsightsDrill.Cancelled, C.endedCancelled],
  [InsightsDrill.Failed, C.endedFailed],
] as const;

/** Quality of the tasks that ended in the period (19 §2.4); each figure opens the tasks behind it. */
export function QualitySection({ summary, onDrill }: { summary: InsightsSummaryDTO; onDrill: Drill }) {
  const q = summary.quality;
  const ended = q.ended.completed + q.ended.cancelled + q.ended.failed;
  const open = (drill: InsightsDrill) => (ended === 0 ? undefined : () => onDrill(drill, null));
  const drillable = (drill: InsightsDrill) => {
    const onOpen = open(drill);
    return onOpen === undefined ? {} : { onOpen };
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{C.qualityTitle}</h2>
        <span className="hint">{ended === 0 ? C.noEnded : C.qualityLede}</span>
      </div>
      <div className={styles.qualityGrid} data-testid="insights-quality">
        <StatCard
          label={C.completionRate}
          value={formatPercent(q.completionRate)}
          sub={
            <span className={styles.endedLinks}>
              {ENDED.map(([drill, label]) => (
                <button
                  key={drill}
                  type="button"
                  className={styles.link}
                  disabled={q.ended[drill] === 0}
                  onClick={() => onDrill(drill, null)}
                >
                  {label(q.ended[drill])}
                </button>
              ))}
            </span>
          }
        />
        <StatCard
          label={C.firstPassRate}
          value={formatPercent(q.firstPassRate)}
          sub={C.firstPassCounts(q.firstPassNodes, q.doneNodes)}
          {...drillable(InsightsDrill.FirstPassMissed)}
        />
        <StatCard
          label={C.avgRetries}
          value={formatAverage(q.avgRetries)}
          sub={C.retryCounts(q.retries, q.finishedNodes)}
          {...drillable(InsightsDrill.Retried)}
        />
        <StatCard
          label={C.avgInterruptions}
          value={formatAverage(q.avgInterruptions)}
          sub={C.interruptionCounts(q.interruptions)}
          {...drillable(InsightsDrill.Interrupted)}
        />
        <StatCard
          label={C.reviewDuration}
          value={formatDuration(q.reviewDurationMedianMs)}
          sub={C.reviewDurationHint}
          {...drillable(InsightsDrill.ReviewDuration)}
        />
      </div>
      <div className={`card ${styles.failures}`}>
        <div className="card-head">
          <h3 className="section-title grow">{C.failuresTitle}</h3>
        </div>
        <div className="card-body">
          {q.failureReasons.length === 0 ? (
            <p className="hint">{C.noFailures}</p>
          ) : (
            <ul className={styles.reasons}>
              {q.failureReasons.map((reason) => (
                <li key={failureKey(reason)}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => onDrill(InsightsDrill.Failure, failureKey(reason))}
                  >
                    {failureName(reason)}
                  </button>
                  <span className="num">{C.times(reason.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
