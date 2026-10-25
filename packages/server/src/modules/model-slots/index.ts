import { getModelSlotsOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import { createModelSlots, type ModelSlotsDeps } from './model-slots.service.ts';

export type { ModelSlots, SlotWaiter } from './model-slots.service.ts';

export function createModelSlotsModule(deps: ModelSlotsDeps) {
  const service = createModelSlots(deps);
  return { service, operations: [implement(getModelSlotsOp, () => service.usage())] };
}
