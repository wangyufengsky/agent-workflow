import { insightsOperations } from './insights.operations.ts';
import { createInsightsService, type InsightsServiceDeps } from './insights.service.ts';

export type { InsightsService } from './insights.service.ts';

export function createInsightsModule(deps: InsightsServiceDeps) {
  const service = createInsightsService(deps);
  return { service, operations: insightsOperations(service) };
}
