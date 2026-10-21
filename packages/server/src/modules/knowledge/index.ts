import { knowledgeOperations } from './knowledge.operations.ts';
import { createKnowledgeService, type KnowledgeServiceDeps } from './knowledge.service.ts';

export type { KnowledgeService, TurnEnded } from './knowledge.service.ts';

export function createKnowledgeModule(deps: KnowledgeServiceDeps) {
  const service = createKnowledgeService(deps);
  return { service, operations: knowledgeOperations(service) };
}
