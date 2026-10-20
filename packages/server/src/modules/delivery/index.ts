import { createDeliveriesService, type DeliveriesServiceDeps } from './delivery.service.ts';

export { checkDeliverable, type LocalMergeInput, type MergeOutcome, mergeLocally } from './delivery.merge.ts';
export type { DeliveriesService } from './delivery.service.ts';

export function createDeliveryModule(deps: DeliveriesServiceDeps) {
  return { service: createDeliveriesService(deps) };
}
