import {
  confirmInitiativeItemMergedOp,
  confirmInitiativeOp,
  createInitiativeOp,
  deleteInitiativeOp,
  deliverInitiativePhaseOp,
  dropInitiativeItemOp,
  getInitiativeOp,
  listInitiativesOp,
  listInitiativeTemplatesOp,
  openInitiativePhaseOp,
  rebreakdownInitiativeOp,
  refineInitiativeOp,
  saveInitiativeDraftOp,
  startInitiativeItemOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { InitiativesService } from './initiatives.service.ts';

export function initiativesOperations(initiatives: InitiativesService) {
  return [
    implement(listInitiativeTemplatesOp, () => ({ items: initiatives.templates.list() })),
    implement(listInitiativesOp, (query) => initiatives.list(query)),
    implement(createInitiativeOp, (input) => initiatives.create(input)),
    implement(getInitiativeOp, ({ id }) => initiatives.detail(id)),
    implement(saveInitiativeDraftOp, ({ id, ...draft }) => initiatives.saveDraft(id, draft)),
    implement(confirmInitiativeOp, ({ id }) => initiatives.confirm(id)),
    implement(openInitiativePhaseOp, ({ id, phase, refine }) => initiatives.openPhase(id, phase, refine)),
    implement(rebreakdownInitiativeOp, ({ id, instruction }) => initiatives.rebreakdown(id, instruction)),
    implement(refineInitiativeOp, ({ id, instruction }) => initiatives.refine(id, instruction)),
    implement(startInitiativeItemOp, ({ id, key }) => initiatives.startItem(id, key)),
    implement(confirmInitiativeItemMergedOp, ({ id, key }) => initiatives.confirmMerged(id, key)),
    implement(dropInitiativeItemOp, ({ id, key, reason }) => initiatives.dropItem(id, key, reason)),
    implement(deliverInitiativePhaseOp, ({ id, phase, strategy }) => initiatives.deliverPhase(id, phase, strategy)),
    implement(deleteInitiativeOp, ({ id }) => initiatives.delete(id)),
  ];
}
