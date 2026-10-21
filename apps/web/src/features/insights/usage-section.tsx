import {
  INSIGHTS_DIMENSIONS,
  type InsightsDimension,
  type InsightsSummaryDTO,
  type InsightsTaskDTO,
  type UsageTotals,
} from '@aw/shared';
import { useState } from 'react';
import { Tabs } from '../../components/tabs.tsx';
import {
  INSIGHTS_COPY as C,
  DIMENSION_LABEL,
  formatCost,
  formatTokens,
  formatTokensShort,
  groupName,
} from '../../copy/insights.ts';
import { BarChart, type BarSeries } from './bar-chart.tsx';
import { CostValue } from './cost-value.tsx';
import { type Drill, drillFilter } from './drill.ts';
import styles from './insights.module.css';
import { StatCard } from './stat-card.tsx';

const COST: BarSeries = { name: C.trendCost, tone: 's0' };
const INPUT: BarSeries = { name: C.trendInput, tone: 's0' };
const OUTPUT: BarSeries = { name: C.trendOutput, tone: 's1' };
const TREND_VIEWS = ['cost', 'tokens'] as const;

/** Usage (19 §2.3): totals, the daily trend and the five breakdowns. */
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
  // Nothing priced: the cost bars would all be empty, the tokens tell more.
  const [trend, setTrend] = useState<(typeof TREND_VIEWS)[number]>(() => (usage.cost > 0 ? 'cost' : 'tokens'));
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{C.usageTitle}</h2>
      </div>
      <div className="grid-4" data-testid="insights-usage">
        <StatCard label={C.tokensInput} value={formatTokens(usage.tokensInput)} />
        <StatCard label={C.tokensOutput} value={formatTokens(usage.tokensOutput)} />
        <StatCard
          label={C.cost}
          value={formatCost(usage.cost)}
          {...(usage.unpricedTokens > 0 && {
            sub: <span title={C.unpricedWhy}>{C.unpriced(formatTokens(usage.unpricedTokens))}</span>,
          })}
        />
        <StatCard label={C.attempts} value={formatTokens(usage.attempts)} />
      </div>
      <p className="hint">{C.assistantNotCounted}</p>

      <div className={`card ${styles.trend}`}>
        <div className="card-head">
          <h3 className="section-title grow">{C.trendTitle}</h3>
          <fieldset className="seg" aria-label={C.trendTitle}>
            {TREND_VIEWS.map((view) => (
              <button key={view} type="button" aria-pressed={trend === view} onClick={() => setTrend(view)}>
                {view === 'cost' ? C.trendCost : C.trendTokens}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="card-body">
          {trend === 'cost' ? (
            <BarChart
              label={C.trendCost}
              series={[COST]}
              days={days.map((d) => ({ date: d.date, values: [{ series: COST, value: d.cost }] }))}
              format={formatCost}
              formatAxis={(v) => `$${v}`}
            />
          ) : (
            <BarChart
              label={C.trendTokens}
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
          )}
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
  const tokens = (u: UsageTotals) => u.tokensInput + u.tokensOutput;
  const most = Math.max(1, ...groups.map(tokens));
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{C.name}</th>
          <th className={styles.num}>{C.columns.tokens}</th>
          <th className={styles.num}>{C.cost}</th>
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
                    <i style={{ width: `${(tokens(group) / most) * 100}%` }} />
                  </span>
                  {formatTokens(tokens(group))}
                </span>
              </td>
              <td className={styles.num}>
                <CostValue usage={group} />
              </td>
              <td className={styles.num}>{group.attempts}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
