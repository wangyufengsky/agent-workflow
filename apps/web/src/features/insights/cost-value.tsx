import type { UsageTotals } from '@aw/shared';
import { INSIGHTS_COPY as C, formatCost } from '../../copy/insights.ts';

/** Cost as reported, with what opencode reported no price for (D78 ②). */
export function CostValue({ usage }: { usage: Pick<UsageTotals, 'cost' | 'unpricedTokens'> }) {
  if (usage.cost === 0 && usage.unpricedTokens > 0) {
    return (
      <span className="badge outline" title={C.unpricedWhy}>
        {C.unpricedBadge}
      </span>
    );
  }
  return <>{formatCost(usage.cost)}</>;
}
