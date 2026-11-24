import {
  AppError,
  type AssistantConfirmationResult,
  type AssistantConfirmationStatus,
  assistantConfirmationResultSchema,
  ErrorCode,
} from '@aw/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import {
  assistantConfirmationsTable,
  assistantContinuationsTable,
  assistantConversationsTable,
  assistantOutboxTable,
} from './assistant.table.ts';

export type Conversation = typeof assistantConversationsTable.$inferSelect;

export type Confirmation = Omit<typeof assistantConfirmationsTable.$inferSelect, 'input' | 'result'> & {
  input: Record<string, unknown>;
  result: AssistantConfirmationResult | null;
};

type Continuation = Omit<typeof assistantContinuationsTable.$inferSelect, 'attachmentIds'> & {
  attachmentIds: string[];
};
const continuationAttachmentIdsSchema = z.array(z.string());
function toContinuation(row: typeof assistantContinuationsTable.$inferSelect): Continuation {
  return { ...row, attachmentIds: continuationAttachmentIdsSchema.parse(JSON.parse(row.attachmentIds)) };
}

const inputSchema = z.record(z.string(), z.unknown());

function toConfirmation(row: typeof assistantConfirmationsTable.$inferSelect): Confirmation {
  // JSON columns are parsed at the boundary (06 §9).
  return {
    ...row,
    input: inputSchema.parse(JSON.parse(row.input)),
    result: row.result === null ? null : assistantConfirmationResultSchema.parse(JSON.parse(row.result)),
  };
}

export function createAssistantRepo(db: DbExecutor) {
  const conversations = assistantConversationsTable;
  const confirmations = assistantConfirmationsTable;
  const outbox = assistantOutboxTable;
  return {
    listContinuations() {
      return db.select().from(assistantContinuationsTable).all().map(toContinuation);
    },
    findContinuation(id: string) {
      const row = db
        .select()
        .from(assistantContinuationsTable)
        .where(eq(assistantContinuationsTable.conversationId, id))
        .get();
      return row === undefined ? undefined : toContinuation(row);
    },
    findContinuationByRequest(requestId: string) {
      const row = db
        .select()
        .from(assistantContinuationsTable)
        .where(eq(assistantContinuationsTable.requestId, requestId))
        .get();
      return row === undefined ? undefined : toContinuation(row);
    },
    insertContinuation(
      row: Omit<typeof assistantContinuationsTable.$inferInsert, 'attachmentIds'> & { attachmentIds: string[] },
    ): void {
      db.insert(assistantContinuationsTable)
        .values({ ...row, attachmentIds: JSON.stringify(row.attachmentIds) })
        .run();
    },
    consumeContinuation(id: string, now: number): void {
      db.update(assistantContinuationsTable)
        .set({ consumedAt: now, draftText: null })
        .where(eq(assistantContinuationsTable.conversationId, id))
        .run();
    },
    enqueueMessage(conversationId: string, text: string, createdAt: number): void {
      db.insert(outbox).values({ conversationId, text, createdAt }).run();
    },
    pendingMessages(conversationId: string): Array<{ id: number; text: string }> {
      return db
        .select({ id: outbox.id, text: outbox.text })
        .from(outbox)
        .where(eq(outbox.conversationId, conversationId))
        .orderBy(asc(outbox.id))
        .all();
    },
    acknowledgeMessages(ids: number[]): void {
      db.delete(outbox).where(inArray(outbox.id, ids)).run();
    },
    insertConversation(row: typeof assistantConversationsTable.$inferInsert): void {
      db.insert(conversations).values(row).run();
    },
    findConversation(id: string): Conversation | undefined {
      return db.select().from(conversations).where(eq(conversations.id, id)).get();
    },
    findBySession(sessionId: string): Conversation | undefined {
      return db.select().from(conversations).where(eq(conversations.opencodeSessionId, sessionId)).get();
    },
    /** Most recently updated first. */
    listConversations(): Conversation[] {
      return db.select().from(conversations).orderBy(desc(conversations.updatedAt), desc(conversations.id)).all();
    },
    updateConversation(id: string, changes: Partial<Omit<Conversation, 'id' | 'createdAt'>>): void {
      db.update(conversations).set(changes).where(eq(conversations.id, id)).run();
    },
    /** Its confirmations go with it (cascade). */
    deleteConversation(id: string): void {
      db.delete(conversations).where(eq(conversations.id, id)).run();
    },

    insertConfirmation(row: Omit<Confirmation, 'result' | 'resolvedAt'>): void {
      db.insert(confirmations)
        .values({ ...row, input: JSON.stringify(row.input) })
        .run();
    },
    findConfirmation(id: string): Confirmation | undefined {
      const row = db.select().from(confirmations).where(eq(confirmations.id, id)).get();
      return row === undefined ? undefined : toConfirmation(row);
    },
    /** Oldest first, the order of the cards in the conversation. */
    listConfirmations(conversationId: string): Confirmation[] {
      return db
        .select()
        .from(confirmations)
        .where(eq(confirmations.conversationId, conversationId))
        .orderBy(asc(confirmations.createdAt), asc(confirmations.id))
        .all()
        .map(toConfirmation);
    },
    /** The only status write (09 §1): guarded by the status the transition started from. */
    resolveConfirmation(
      id: string,
      from: AssistantConfirmationStatus,
      to: AssistantConfirmationStatus,
      changes: { result: AssistantConfirmationResult | null; resolvedAt: number },
    ): void {
      const updated = db
        .update(confirmations)
        .set({
          status: to,
          result: changes.result === null ? null : JSON.stringify(changes.result),
          resolvedAt: changes.resolvedAt,
        })
        .where(and(eq(confirmations.id, id), eq(confirmations.status, from)))
        .run();
      if (updated.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `Confirmation ${id} is no longer ${from}`, {
          entity: 'assistant_confirmation',
          from,
          to,
        });
      }
    },
    /** What the confirmed operation returned, written once it ran. */
    setConfirmationResult(id: string, result: AssistantConfirmationResult): void {
      db.update(confirmations)
        .set({ result: JSON.stringify(result) })
        .where(eq(confirmations.id, id))
        .run();
    },
  };
}
export type AssistantRepo = ReturnType<typeof createAssistantRepo>;
