import { type CitationDTO, citationSchema, type KnowledgeSources, knowledgeSourcesSchema } from '@aw/shared';
import { and, asc, desc, eq, exists, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { knowledgeConversationsTable, knowledgeTurnsTable } from './knowledge.table.ts';

type ConversationRow = typeof knowledgeConversationsTable.$inferSelect;
type TurnRow = typeof knowledgeTurnsTable.$inferSelect;

export type Conversation = Omit<ConversationRow, 'sources'> & { sources: KnowledgeSources };
export type Turn = Omit<TurnRow, 'citations'> & { citations: CitationDTO[] };

const citationsSchema = z.array(citationSchema);

// JSON columns are parsed at the boundary (06 §9).
const toConversation = ({ sources, ...row }: ConversationRow): Conversation => ({
  ...row,
  sources: knowledgeSourcesSchema.parse(JSON.parse(sources)),
});
const toTurn = ({ citations, ...row }: TurnRow): Turn => ({
  ...row,
  citations: citations === null ? [] : citationsSchema.parse(JSON.parse(citations)),
});

/** `%`, `_` and the escape character itself match literally in a LIKE pattern. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createKnowledgeRepo(db: DbExecutor) {
  const c = knowledgeConversationsTable;
  const t = knowledgeTurnsTable;

  return {
    insertConversation(conversation: Conversation): void {
      db.insert(c)
        .values({ ...conversation, sources: JSON.stringify(conversation.sources) })
        .run();
    },
    findConversation(id: string): Conversation | undefined {
      const row = db.select().from(c).where(eq(c.id, id)).get();
      return row === undefined ? undefined : toConversation(row);
    },
    touchConversation(id: string, updatedAt: number): void {
      db.update(c).set({ updatedAt }).where(eq(c.id, id)).run();
    },
    /** Its turns go with it (cascade); their attempts are deleted by the caller. */
    deleteConversation(id: string): void {
      db.delete(c).where(eq(c.id, id)).run();
    },
    listConversationIds(projectId: string): string[] {
      return db
        .select({ id: c.id })
        .from(c)
        .where(eq(c.projectId, projectId))
        .all()
        .map((r) => r.id);
    },
    /**
     * One page, most recently updated first (11 §1): `after` is where the previous page ended. `query` matches any
     * question or answer of the conversation.
     */
    page(
      filter: { projectId?: string | undefined; query?: string | undefined },
      after: { updatedAt: number; id: string } | undefined,
      limit: number,
    ): Conversation[] {
      const conditions: SQL[] = [];
      if (filter.projectId !== undefined) conditions.push(eq(c.projectId, filter.projectId));
      if (filter.query !== undefined) {
        const pattern = likePattern(filter.query);
        const matches = or(
          sql`${t.question} like ${pattern} escape '\\'`,
          sql`${t.answer} like ${pattern} escape '\\'`,
        );
        conditions.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(t)
              .where(and(eq(t.conversationId, c.id), matches)),
          ),
        );
      }
      if (after !== undefined) {
        const older = or(lt(c.updatedAt, after.updatedAt), and(eq(c.updatedAt, after.updatedAt), lt(c.id, after.id)));
        if (older !== undefined) conditions.push(older);
      }
      return db
        .select()
        .from(c)
        .where(and(...conditions))
        .orderBy(desc(c.updatedAt), desc(c.id))
        .limit(limit)
        .all()
        .map(toConversation);
    },

    insertTurn(turn: Omit<Turn, 'answer' | 'citations' | 'answeredAt'>): void {
      db.insert(t).values(turn).run();
    },
    findTurn(id: string): Turn | undefined {
      const row = db.select().from(t).where(eq(t.id, id)).get();
      return row === undefined ? undefined : toTurn(row);
    },
    findTurnByAttempt(attemptId: string): Turn | undefined {
      const row = db.select().from(t).where(eq(t.attemptId, attemptId)).get();
      return row === undefined ? undefined : toTurn(row);
    },
    /** Oldest first. */
    listTurns(conversationId: string): Turn[] {
      return db.select().from(t).where(eq(t.conversationId, conversationId)).orderBy(asc(t.seq)).all().map(toTurn);
    },
    /** The turns of several conversations at once (a list page), oldest first within each. */
    listTurnsOf(conversationIds: readonly string[]): Turn[] {
      if (conversationIds.length === 0) return [];
      return db
        .select()
        .from(t)
        .where(inArray(t.conversationId, conversationIds))
        .orderBy(asc(t.seq))
        .all()
        .map(toTurn);
    },
    setAnswer(id: string, answer: { answer: string; citations: CitationDTO[]; answeredAt: number }): void {
      db.update(t)
        .set({ ...answer, citations: JSON.stringify(answer.citations) })
        .where(eq(t.id, id))
        .run();
    },
  };
}
export type KnowledgeRepo = ReturnType<typeof createKnowledgeRepo>;
