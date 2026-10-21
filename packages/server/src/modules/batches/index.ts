import { batchesOperations } from './batches.operations.ts';
import { type BatchesServiceDeps, createBatchesService } from './batches.service.ts';

export type { BatchesService } from './batches.service.ts';

export function createBatchesModule(deps: BatchesServiceDeps) {
  const service = createBatchesService(deps);
  return { service, operations: batchesOperations(service) };
}
