import { z } from 'zod';

/** Objects an operation can produce (`OperationContract.produces`); the renderer maps each to its page (D66). */
export const EntityKind = {
  Task: 'task',
  Project: 'project',
  /** Identified by its key: the editor's route is `/workflows/:key`. */
  Workflow: 'workflow',
  Role: 'role',
  DbConnection: 'db_connection',
  /** A knowledge Q&A conversation (18). */
  KnowledgeConversation: 'knowledge_conversation',
  /** A batch of tasks made from one fixed workflow (20). */
  Batch: 'batch',
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];
export const entityKindSchema = z.enum(EntityKind);

/** A produced object as the assistant's message stream records it (10 §3 `entity_ref`). */
export const entityRefSchema = z.object({ kind: entityKindSchema, id: z.string(), title: z.string() });
export type EntityRef = z.infer<typeof entityRefSchema>;

/**
 * What an operation's input field names (`OperationContract.refs`): an object kind above, or one that is only referred
 * to. A confirmation card shows the object's name instead of its id (15 §4).
 */
export const InputRef = {
  ...EntityKind,
  InboxItem: 'inbox_item',
  /** A step of the task named by the same input's `id`. */
  Node: 'node',
  Attempt: 'attempt',
} as const;
export type InputRef = (typeof InputRef)[keyof typeof InputRef];
