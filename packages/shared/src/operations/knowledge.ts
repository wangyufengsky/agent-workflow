import { z } from 'zod';
import { attachmentSchema } from '../contracts/api/attachments.ts';
import {
  askKnowledgeRequestSchema,
  citationSourceSchema,
  followUpKnowledgeRequestSchema,
  knowledgeConversationSchema,
  knowledgeConversationSummarySchema,
  knowledgeTaskMaterialRequestSchema,
  listKnowledgeQuerySchema,
} from '../contracts/api/knowledge.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk, permissionModeSchema } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
// Knowledge Q&A is a simple-mode feature the assistant can use too (D68).
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

export const listKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.list',
  title: 'op.knowledge.list',
  description: 'Knowledge conversations (questions about a project), most recently updated first',
  input: listKnowledgeQuerySchema,
  output: z.object({ items: z.array(knowledgeConversationSummarySchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/knowledge/conversations' },
});

export const getKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.get',
  title: 'op.knowledge.get',
  description: 'A knowledge conversation: its questions, their status, answers and citations',
  input: byId,
  output: knowledgeConversationSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/knowledge/conversations/:id' },
});

export const askKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.ask',
  title: 'op.knowledge.ask',
  description: 'Ask a question about a project; a read-only researcher answers with citations',
  input: askKnowledgeRequestSchema,
  assistantOmit: ['permissionMode'],
  output: knowledgeConversationSchema,
  // Only reads the project; the assistant runs it without a confirmation and gets the answer later (D68, 18 §4a).
  risk: OperationRisk.Read,
  produces: { kind: EntityKind.KnowledgeConversation, ref: (c) => ({ id: c.id, title: c.title }) },
  http: { method: 'POST', path: '/knowledge/conversations', status: 201 },
});

export const followUpKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.followUp',
  title: 'op.knowledge.followUp',
  description: 'Ask a follow-up question in a knowledge conversation once its previous question is finished',
  input: followUpKnowledgeRequestSchema,
  output: knowledgeConversationSchema,
  risk: OperationRisk.Read,
  produces: { kind: EntityKind.KnowledgeConversation, ref: (c) => ({ id: c.id, title: c.title }) },
  http: { method: 'POST', path: '/knowledge/conversations/:id/turns' },
});

export const setKnowledgePermissionModeOp = defineOperationContract({
  ...common,
  expose: { palette: false, assistant: false },
  id: 'knowledge.setPermissionMode',
  title: 'op.knowledge.setPermissionMode',
  description: 'Set the permission mode of a knowledge conversation',
  input: byId.extend({ permissionMode: permissionModeSchema }),
  output: knowledgeConversationSchema,
  risk: OperationRisk.Critical,
  http: { method: 'PATCH', path: '/knowledge/conversations/:id/permission-mode' },
});

export const stopKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.stop',
  refs: { id: InputRef.KnowledgeConversation },
  title: 'op.knowledge.stop',
  description: 'Stop the question a knowledge conversation is researching',
  input: byId,
  output: knowledgeConversationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/knowledge/conversations/:id/stop' },
});

export const deleteKnowledgeOp = defineOperationContract({
  ...common,
  id: 'knowledge.delete',
  refs: { id: InputRef.KnowledgeConversation },
  title: 'op.knowledge.delete',
  description: 'Delete a knowledge conversation with its research records',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/knowledge/conversations/:id' },
});

export const knowledgeCitationOp = defineOperationContract({
  ...common,
  id: 'knowledge.citation',
  title: 'op.knowledge.citation',
  description: 'The original behind one citation of an answer: file lines, query rows or web address',
  input: z.object({ turnId: z.string(), index: z.coerce.number().int().min(1) }),
  output: citationSourceSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/knowledge/turns/:turnId/citations/:index' },
});

export const snapshotKnowledgeTaskMaterialOp = defineOperationContract({
  ...common,
  expose: { palette: false, assistant: false },
  id: 'knowledge.snapshotTaskMaterial',
  title: 'op.knowledge.snapshotTaskMaterial',
  description: 'Save the selected verified answer excerpt and citations as a task attachment',
  input: knowledgeTaskMaterialRequestSchema,
  output: attachmentSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/knowledge/conversations/:id/task-material', status: 201 },
});
