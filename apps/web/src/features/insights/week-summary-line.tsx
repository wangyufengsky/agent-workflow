import { InsightsPeriod } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { INSIGHTS_COPY as C, formatTokens } from '../../copy/insights.ts';
import { insightsSummaryQuery } from './insights.queries.ts';

/**
 * This week's three figures on one line, at the top of the simple task list (38 C1, D158): the simple sidebar has no
 * 「质量与用量」, and this is all its simple view showed. The title links to the page, which both modes can open.
 */
export function WeekSummaryLine() {
  const summary = useQuery(insightsSummaryQuery({ period: InsightsPeriod.Week }));
  if (summary.data === undefined) return null;
  const { quality, usage, attention } = summary.data;
  return (
    <p className="hint" data-testid="week-summary">
      <Link to={ROUTES.insights}>{C.thisWeek}</Link>
      {' · '}
      {[
        C.completed(quality.ended.completed),
        C.used(formatTokens(usage.tokensInput + usage.tokensOutput)),
        C.interrupted(attention.interruptions),
      ].join(' · ')}
    </p>
  );
}
