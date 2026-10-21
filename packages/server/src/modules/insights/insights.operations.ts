import { insightsSummaryOp, insightsTasksOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { InsightsService } from './insights.service.ts';

export function insightsOperations(insights: InsightsService) {
  return [
    implement(insightsSummaryOp, (query) => insights.summary(query)),
    implement(insightsTasksOp, (query) => insights.tasks(query)),
  ];
}
