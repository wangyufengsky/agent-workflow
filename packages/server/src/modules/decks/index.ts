import { decksOperations } from './decks.operations.ts';
import { createDecksService, type DecksServiceDeps } from './decks.service.ts';

export type { DecksService } from './decks.service.ts';
export { deckMaterialsTable, deckRunsTable, deckSlidesTable, decksTable } from './decks.table.ts';

export function createDecksModule(deps: DecksServiceDeps) {
  const service = createDecksService(deps);
  return { service, operations: decksOperations(service) };
}
