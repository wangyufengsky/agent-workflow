import {
  askKnowledgeOp,
  deleteKnowledgeOp,
  followUpKnowledgeOp,
  getKnowledgeOp,
  knowledgeCitationOp,
  listKnowledgeOp,
  stopKnowledgeOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { KnowledgeService } from './knowledge.service.ts';

export function knowledgeOperations(knowledge: KnowledgeService) {
  return [
    implement(listKnowledgeOp, (input) => knowledge.list(input)),
    implement(getKnowledgeOp, ({ id }) => knowledge.get(id)),
    implement(askKnowledgeOp, (input) => knowledge.ask(input)),
    implement(followUpKnowledgeOp, ({ id, question, model }) => knowledge.followUp(id, question, model)),
    implement(stopKnowledgeOp, ({ id }) => knowledge.stop(id)),
    implement(deleteKnowledgeOp, ({ id }) => knowledge.delete(id)),
    implement(knowledgeCitationOp, ({ turnId, index }) => knowledge.citation(turnId, index)),
  ];
}
