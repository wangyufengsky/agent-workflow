import {
  createDeckOp,
  deleteDeckOp,
  deleteSlideOp,
  generateDeckOp,
  getDeckOp,
  insertSlideOp,
  listDecksOp,
  moveSlideOp,
  restoreSlideOp,
  reviseOutlineOp,
  reviseSlidesOp,
  stopDeckOp,
  updateDeckOp,
  updateOutlineOp,
  updateSlideOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { DecksService } from './decks.service.ts';

export function decksOperations(decks: DecksService) {
  return [
    implement(listDecksOp, (input) => decks.list(input)),
    implement(getDeckOp, ({ id }) => decks.get(id)),
    implement(createDeckOp, (input) => decks.create(input)),
    implement(updateDeckOp, ({ id, title, theme }) => decks.update(id, { title, theme })),
    implement(reviseOutlineOp, ({ id, instruction, model }) => decks.reviseOutline(id, instruction, model)),
    implement(updateOutlineOp, ({ id, slides }) => decks.updateOutline(id, { slides })),
    implement(generateDeckOp, ({ id, model }) => decks.generate(id, model)),
    implement(reviseSlidesOp, ({ id, slideIds, instruction, model }) =>
      decks.reviseSlides(id, slideIds, instruction, model),
    ),
    implement(updateSlideOp, ({ id, slideId, content, notes }) => decks.updateSlide(id, slideId, content, notes)),
    implement(restoreSlideOp, ({ id, slideId }) => decks.restoreSlide(id, slideId)),
    implement(insertSlideOp, ({ id, model, ...page }) => decks.insertSlide(id, page, model)),
    implement(moveSlideOp, ({ id, slideId, toSeq }) => decks.moveSlide(id, slideId, toSeq)),
    implement(deleteSlideOp, ({ id, slideId }) => decks.deleteSlide(id, slideId)),
    implement(stopDeckOp, ({ id }) => decks.stop(id)),
    implement(deleteDeckOp, ({ id }) => decks.delete(id)),
  ];
}
