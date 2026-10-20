import { plansOperations } from './plans.operations.ts';
import { createPlansService, type PlansServiceDeps } from './plans.service.ts';

export { planGraphFromSubmission, validateSubmission } from './plans.convert.ts';
export type { NewPlan, PlansService } from './plans.service.ts';

export function createPlansModule(deps: PlansServiceDeps) {
  const service = createPlansService(deps);
  return { service, operations: plansOperations(service) };
}
