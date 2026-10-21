import { INSIGHTS_PERIODS, InsightsPeriod, type InsightsQuery } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useRef } from 'react';
import { ROUTE_IDS } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INSIGHTS_COPY as C, PERIOD_LABEL } from '../../copy/insights.ts';
import type { Drill } from './drill.ts';
import styles from './insights.module.css';
import { insightsSummaryQuery, insightsTasksQuery } from './insights.queries.ts';
import { InsightsTaskTable } from './insights-task-table.tsx';
import { QualitySection } from './quality-section.tsx';
import { UsageSection } from './usage-section.tsx';

const route = getRouteApi(ROUTE_IDS.insights);
const DAY_MS = 86_400_000;
/** A date of the user's calendar, as the backend counts days in the same (system) time zone. */
const localDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA');

/** The pro view (19 §3.2): period, usage, trend, breakdowns, quality and the tasks behind each figure. */
export function ProInsights() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const period = search.period ?? InsightsPeriod.Week;
  const today = localDate(Date.now());
  const query: InsightsQuery =
    period === InsightsPeriod.Custom
      ? { period, from: search.from ?? localDate(Date.now() - 6 * DAY_MS), to: search.to ?? today }
      : { period };
  const summary = useQuery(insightsSummaryQuery(query));
  const tasks = useQuery(insightsTasksQuery(query));
  const table = useRef<HTMLElement>(null);

  const drill: Drill = (to, key) => {
    void navigate({ search: (prev) => ({ ...prev, drill: to, key: key ?? undefined }) });
    table.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const choose = (next: InsightsPeriod) =>
    void navigate({
      search: next === InsightsPeriod.Custom ? { period: next, from: query.from, to: query.to } : { period: next },
    });
  const setDates = (dates: { from?: string; to?: string }) =>
    void navigate({ search: (prev) => ({ ...prev, from: query.from, to: query.to, ...dates }) });

  const isEmpty =
    summary.data !== undefined &&
    summary.data.usage.attempts === 0 &&
    tasks.data !== undefined &&
    tasks.data.items.length === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      <div className={styles.toolbar}>
        <fieldset className="seg" aria-label={C.periodLabel}>
          {INSIGHTS_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={p === period} onClick={() => choose(p)}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </fieldset>
        {query.period === InsightsPeriod.Custom && (
          <>
            <input
              type="date"
              className="input"
              aria-label={C.from}
              value={query.from}
              max={query.to}
              onChange={(e) => setDates({ from: e.target.value })}
            />
            <input
              type="date"
              className="input"
              aria-label={C.to}
              value={query.to}
              min={query.from}
              max={today}
              onChange={(e) => setDates({ to: e.target.value })}
            />
          </>
        )}
      </div>
      {(summary.isPending || tasks.isPending) && <p className="hint">{COMMON_COPY.loading}</p>}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}
      {tasks.isError && <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {isEmpty && <EmptyState icon="chart" title={C.emptyTitle} body={C.emptyBody} />}
      {!isEmpty && summary.data !== undefined && tasks.data !== undefined && (
        <>
          <UsageSection summary={summary.data} rows={tasks.data.items} onDrill={drill} />
          <QualitySection summary={summary.data} onDrill={drill} />
          <section ref={table} className="section" aria-label={C.tasksTitle}>
            <InsightsTaskTable
              rows={tasks.data.items}
              summary={summary.data}
              drill={search.drill}
              drillKey={search.key ?? null}
              onClear={() => void navigate({ search: (prev) => ({ ...prev, drill: undefined, key: undefined }) })}
            />
          </section>
        </>
      )}
    </div>
  );
}
