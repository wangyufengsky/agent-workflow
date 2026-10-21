import { createBatchOp, deliverBatchOp, getBatchOp, listBatchesOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BatchesService } from './batches.service.ts';

export function batchesOperations(batches: BatchesService) {
  return [
    implement(listBatchesOp, (query) => batches.list(query)),
    implement(createBatchOp, (input) => batches.create(input)),
    implement(getBatchOp, ({ id }) => batches.detail(id)),
    implement(deliverBatchOp, ({ id, strategy }) => batches.deliver(id, strategy)),
  ];
}
