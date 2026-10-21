import { InsightsPeriod, insightsDrillSchema, insightsPeriodSchema, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INSIGHTS_COPY as C, formatTokens } from '../../copy/insights.ts';
import { useSettings, useUpdateSettings } from '../settings/settings.queries.ts';
import styles from './insights.module.css';
import { insightsSummaryQuery } from './insights.queries.ts';
import { ProInsights } from './pro-insights.tsx';
import { StatCard } from './stat-card.tsx';

/** `/insights` search (19 §3.2): the period, and the metric whose tasks the table shows. */
export const insightsSearchSchema = z.object({
  period: insightsPeriodSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  drill: insightsDrillSchema.optional(),
  key: z.string().optional(),
});
export type InsightsSearch = z.infer<typeof insightsSearchSchema>;

/** Quality and usage (19 §3): three figures of this week in simple mode, the whole picture in pro mode. */
export function InsightsPage() {
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  return pro ? <ProInsights /> : <SimpleInsights />;
}

function SimpleInsights() {
  const summary = useQuery(insightsSummaryQuery({ period: InsightsPeriod.Week }));
  const update = useUpdateSettings();
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.simpleLede}</p>
        </div>
      </div>
      {summary.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}
      {summary.data !== undefined && (
        <div className="grid-3" data-testid="insights-simple">
          <StatCard label={C.completedHint} value={C.completed(summary.data.quality.ended.completed)} />
          <StatCard
            label={C.usedHint}
            value={C.used(formatTokens(summary.data.usage.tokensInput + summary.data.usage.tokensOutput))}
          />
          <StatCard label={C.interruptedHint} value={C.interrupted(summary.data.attention.interruptions)} />
        </div>
      )}
      <div className={`banner info ${styles.proHint}`}>
        <span className="grow">{C.proHint}</span>
        <Button pending={update.isPending} onClick={() => update.mutate({ 'ui.mode': UiMode.Pro })}>
          {C.enablePro}
        </Button>
      </div>
    </div>
  );
}
