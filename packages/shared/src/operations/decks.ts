import { z } from 'zod';
import {
  createDeckRequestSchema,
  deckSchema,
  deckSlideRefSchema,
  deckSummarySchema,
  generateDeckRequestSchema,
  insertSlideRequestSchema,
  listDecksQuerySchema,
  moveSlideRequestSchema,
  reviseOutlineRequestSchema,
  reviseSlidesRequestSchema,
  updateDeckRequestSchema,
  updateOutlineRequestSchema,
  updateSlideRequestSchema,
} from '../contracts/api/decks.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
// PPT is a simple-mode feature the assistant can use too (D96); creating and changing one needs its confirmation.
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;
const deckRef = { id: InputRef.Deck } as const;
const produces = { kind: EntityKind.Deck, ref: (d: z.output<typeof deckSchema>) => ({ id: d.id, title: d.title }) };

export const listDecksOp = defineOperationContract({
  ...common,
  id: 'decks.list',
  title: 'op.decks.list',
  description: 'PPTs (slide decks the app makes from a brief and material), most recently updated first',
  input: listDecksQuerySchema,
  output: z.object({ items: z.array(deckSummarySchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/decks' },
});

export const getDeckOp = defineOperationContract({
  ...common,
  id: 'decks.get',
  refs: deckRef,
  title: 'op.decks.get',
  description: 'A PPT: its brief, material, the AI understanding, every page (outline and content) and its AI work',
  input: byId,
  output: deckSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/decks/:id' },
});

export const createDeckOp = defineOperationContract({
  ...common,
  id: 'decks.create',
  title: 'op.decks.create',
  description:
    'Create a PPT from a brief and material (pasted text, a task result, a knowledge conversation; a project whose ' +
    'code the AI may read). The AI writes an outline first; the user confirms it before the pages are made.',
  input: createDeckRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  produces,
  http: { method: 'POST', path: '/decks', status: 201 },
});

export const updateDeckOp = defineOperationContract({
  ...common,
  id: 'decks.update',
  refs: deckRef,
  title: 'op.decks.update',
  description: 'Rename a PPT or change its theme (no AI work; the pages are shown in the new theme at once)',
  input: updateDeckRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/decks/:id' },
});

export const reviseOutlineOp = defineOperationContract({
  ...common,
  id: 'decks.reviseOutline',
  refs: deckRef,
  title: 'op.decks.reviseOutline',
  description: "Let the AI rewrite a PPT's outline following an instruction, before the outline is confirmed",
  input: reviseOutlineRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/outline/revise' },
});

export const updateOutlineOp = defineOperationContract({
  ...common,
  id: 'decks.updateOutline',
  refs: deckRef,
  title: 'op.decks.updateOutline',
  description: "Save a PPT's outline as edited (pages with layout, title and points), before it is confirmed",
  input: updateOutlineRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/decks/:id/outline' },
});

export const generateDeckOp = defineOperationContract({
  ...common,
  id: 'decks.generate',
  refs: deckRef,
  title: 'op.decks.generate',
  description:
    "Confirm a PPT's outline (the first time) and let the AI make every page not made yet; also continues after a stop",
  input: generateDeckRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/generate' },
});

export const reviseSlidesOp = defineOperationContract({
  ...common,
  id: 'decks.reviseSlides',
  refs: deckRef,
  title: 'op.decks.reviseSlides',
  description: 'Let the AI revise made pages of a PPT following an instruction; what it replaces can be restored',
  input: reviseSlidesRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/revise' },
});

export const updateSlideOp = defineOperationContract({
  ...common,
  id: 'decks.updateSlide',
  refs: deckRef,
  title: 'op.decks.updateSlide',
  description: "Change one page's content and speaker notes by hand",
  input: updateSlideRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/decks/:id/slides/:slideId' },
});

export const restoreSlideOp = defineOperationContract({
  ...common,
  id: 'decks.restoreSlide',
  refs: deckRef,
  title: 'op.decks.restoreSlide',
  description: 'Undo the latest AI change of one page',
  input: deckSlideRefSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/slides/:slideId/restore' },
});

export const insertSlideOp = defineOperationContract({
  ...common,
  id: 'decks.insertSlide',
  refs: deckRef,
  title: 'op.decks.insertSlide',
  description: 'Add a page (layout, title, points) to a PPT whose outline is confirmed; the AI makes only that page',
  input: insertSlideRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/slides' },
});

export const moveSlideOp = defineOperationContract({
  ...common,
  id: 'decks.moveSlide',
  refs: deckRef,
  title: 'op.decks.moveSlide',
  description: 'Move one page of a PPT to another position (from 1)',
  input: moveSlideRequestSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/slides/:slideId/move' },
});

export const deleteSlideOp = defineOperationContract({
  ...common,
  id: 'decks.deleteSlide',
  refs: deckRef,
  title: 'op.decks.deleteSlide',
  description: 'Delete one page of a PPT (not its last page)',
  input: deckSlideRefSchema,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/decks/:id/slides/:slideId' },
});

export const stopDeckOp = defineOperationContract({
  ...common,
  id: 'decks.stop',
  refs: deckRef,
  title: 'op.decks.stop',
  description: "Stop a PPT's AI work in progress; pages made so far are kept",
  input: byId,
  output: deckSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/decks/:id/stop' },
});

export const deleteDeckOp = defineOperationContract({
  ...common,
  id: 'decks.delete',
  refs: deckRef,
  title: 'op.decks.delete',
  description: 'Delete a PPT with its pages and AI records',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/decks/:id' },
});
