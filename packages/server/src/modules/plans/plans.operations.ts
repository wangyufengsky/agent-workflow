import { getPlanOp, listPlansOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { PlansService } from './plans.service.ts';

export function plansOperations(plans: PlansService) {
  return [
    implement(listPlansOp, ({ id }) => ({ items: plans.list(id) })),
    implement(getPlanOp, ({ id, version }) => plans.getByVersion(id, version)),
  ];
}
