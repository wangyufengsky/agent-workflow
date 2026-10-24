import {
  INSIGHTS_DIMENSIONS,
  type InsightsDimension,
  type InsightsSummaryDTO,
  type InsightsTaskDTO,
  type UsageTotals,
} from '@aw/shared';
import { BarChart, type BarSeries } from '../../components/charts/bar-chart.tsx';
import { Tabs } from '../../components/tabs.tsx';
import {
  INSIGHTS_COPY as C,
  DIMENSION_LABEL,
  formatTokens,
  formatTokensShort,
  groupName,
} from '../../copy/insights.ts';
import { type Drill, drillFilter } from './drill.ts';
import styles from './insights.module.css';
import { StatCard } from './stat-card.tsx';

const INPUT: BarSeries = { name: C.tokensInput, tone: 's0' };
const OUTPUT: BarSeries = { name: C.tokensOutput, tone: 's1' };
const total = (u: UsageTotals) => u.tokensInput + u.tokensOutput;

/** Usage in tokens (19 §2.3, D79): totals, the daily trend and the five breakdowns. */
export function UsageSection({
  summary,
  rows,
  onDrill,
}: {
  summary: InsightsSummaryDTO;
  rows: readonly InsightsTaskDTO[];
  onDrill: Drill;
}) {
  const { usage, days } = summary;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{C.usageTitle}</h2>
      </div>
      <div className="grid-4" data-testid="insights-usage">
        <StatCard label={C.tokensTotal} value={formatTokens(total(usage))} />
        <StatCard label={C.tokensInput} value={formatTokens(usage.tokensInput)} />
        <StatCard label={C.tokensOutput} value={formatTokens(usage.tokensOutput)} />
        <StatCard label={C.attempts} value={formatTokens(usage.attempts)} />
      </div>
      <p className="hint">{C.assistantNotCounted}</p>

      <div className={`card ${styles.trend}`}>
        <div className="card-head">
          <h3 className="section-title grow">{C.trendTitle}</h3>
        </div>
        <div className="card-body">
          <BarChart
            label={C.trendTitle}
            series={[INPUT, OUTPUT]}
            days={days.map((d) => ({
              date: d.date,
              values: [
                { series: INPUT, value: d.tokensInput },
                { series: OUTPUT, value: d.tokensOutput },
              ],
            }))}
            format={formatTokens}
            formatAxis={formatTokensShort}
          />
        </div>
      </div>

      <div className={`card ${styles.breakdown}`}>
        <div className="card-head">
          <h3 className="section-title grow">{C.breakdownTitle}</h3>
        </div>
        <div className="card-body">
          <Tabs
            items={INSIGHTS_DIMENSIONS.map((dimension) => ({
              value: dimension,
              label: DIMENSION_LABEL[dimension],
              content: <GroupTable dimension={dimension} summary={summary} rows={rows} onDrill={onDrill} />,
            }))}
          />
        </div>
      </div>
    </section>
  );
}

function GroupTable({
  dimension,
  summary,
  rows,
  onDrill,
}: {
  dimension: InsightsDimension;
  summary: InsightsSummaryDTO;
  rows: readonly InsightsTaskDTO[];
  onDrill: Drill;
}) {
  const groups = summary.usage.groups[dimension];
  const most = Math.max(1, ...groups.map(total));
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{C.name}</th>
          <th className={styles.num}>{C.tokensTotal}</th>
          <th className={styles.num}>{C.tokensInput}</th>
          <th className={styles.num}>{C.tokensOutput}</th>
          <th className={styles.num}>{C.attempts}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const name = groupName(dimension, group.key, group.name);
          // Knowledge Q&A has usage but no tasks to show.
          const hasTasks = rows.some(drillFilter(dimension, group.key));
          return (
            <tr key={String(group.key)}>
              <td>
                {hasTasks ? (
                  <button type="button" className={styles.link} onClick={() => onDrill(dimension, group.key)}>
                    {name}
                  </button>
                ) : (
                  name
                )}
              </td>
              <td className={styles.num}>
                <span className={styles.barCell}>
                  <span className={styles.barTrack} aria-hidden="true">
                    <i style={{ width: `${(total(group) / most) * 100}%` }} />
                  </span>
                  {formatTokens(total(group))}
                </span>
              </td>
              <td className={styles.num}>{formatTokens(group.tokensInput)}</td>
              <td className={styles.num}>{formatTokens(group.tokensOutput)}</td>
              <td className={styles.num}>{group.attempts}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
