import { AppError, AssistantTurnEvent, AssistantTurnStatus, type AssistantUsageDTO, ErrorCode } from '@aw/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { assistantTurnsTable as turns } from './assistant.table.ts';

type Row = typeof turns.$inferSelect;
export type AssistantTurn = Omit<Row, 'messageIds' | 'stepIds'> & { messageIds: string[]; stepIds: string[] };
const ids = z.array(z.string());
const decode = (row: Row): AssistantTurn => ({
  ...row,
  messageIds: ids.parse(JSON.parse(row.messageIds)),
  stepIds: ids.parse(JSON.parse(row.stepIds)),
});

export function createAssistantUsageRepo(db: DbExecutor) {
  return {
    create(input: Pick<Row, 'conversationId' | 'source' | 'model' | 'startedAt' | 'timeoutMs'>): AssistantTurn {
      return decode(
        db
          .insert(turns)
          .values({
            ...input,
            status: AssistantTurnStatus.Running,
            messageIds: '[]',
            stepIds: '[]',
          })
          .returning()
          .get(),
      );
    },
    running(): AssistantTurn[] {
      return db.select().from(turns).where(eq(turns.status, AssistantTurnStatus.Running)).all().map(decode);
    },
    byMessage(conversationId: string, messageId: string): AssistantTurn | undefined {
      const row = db
        .select()
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            sql`exists (select 1 from json_each(${turns.messageIds}) where value = ${messageId})`,
          ),
        )
        .get();
      return row === undefined ? undefined : decode(row);
    },
    addMessage(turn: AssistantTurn, messageId: string): void {
      db.update(turns)
        .set({ messageIds: JSON.stringify([...turn.messageIds, messageId]) })
        .where(eq(turns.id, turn.id))
        .run();
    },
    addUsage(turn: AssistantTurn, partId: string, tokens: { input: number; output: number }): void {
      db.update(turns)
        .set({
          tokensInput: sql`coalesce(${turns.tokensInput}, 0) + ${tokens.input}`,
          tokensOutput: sql`coalesce(${turns.tokensOutput}, 0) + ${tokens.output}`,
          stepIds: JSON.stringify([...turn.stepIds, partId]),
        })
        .where(eq(turns.id, turn.id))
        .run();
    },
    finish(turn: AssistantTurn, status: AssistantTurnStatus, event: AssistantTurnEvent, now: number): void {
      const result = db
        .update(turns)
        .set({
          status,
          endReason: event,
          endedAt: now,
          // 重启时只知道上次未结束，不能把离线时段声称为实际耗时。
          elapsedMs: event === AssistantTurnEvent.BackendRestart ? null : now - turn.startedAt,
        })
        .where(and(eq(turns.id, turn.id), eq(turns.status, turn.status)))
        .run();
      if (result.changes === 0) throw new AppError(ErrorCode.StateTransitionInvalid, 'Assistant turn already ended');
    },
    /** 对话列表一次取齐，避免每个会话再查一遍历史。 */
    summaries(conversationIds: string[], now: number): Map<string, AssistantUsageDTO> {
      const result = new Map<string, AssistantUsageDTO>(
        conversationIds.map((id) => [
          id,
          {
            latest: null,
            recordedFrom: null,
            turns: 0,
            unknownTurns: 0,
            tokensInput: null,
            tokensOutput: null,
          },
        ]),
      );
      for (const row of db
        .select()
        .from(turns)
        .where(inArray(turns.conversationId, conversationIds))
        .orderBy(asc(turns.id))
        .all()) {
        const summary = result.get(row.conversationId);
        if (summary === undefined) throw new Error('Unexpected conversation in usage query');
        summary.recordedFrom ??= row.startedAt;
        summary.turns += 1;
        if (row.tokensInput === null || row.tokensOutput === null) summary.unknownTurns += 1;
        if (row.tokensInput !== null) summary.tokensInput = (summary.tokensInput ?? 0) + row.tokensInput;
        if (row.tokensOutput !== null) summary.tokensOutput = (summary.tokensOutput ?? 0) + row.tokensOutput;
        summary.latest = {
          id: row.id,
          source: row.source,
          status: row.status,
          endReason: row.endReason,
          model: row.model,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          elapsedMs: row.status === AssistantTurnStatus.Running ? now - row.startedAt : row.elapsedMs,
          tokensInput: row.tokensInput,
          tokensOutput: row.tokensOutput,
          timeoutMs: row.timeoutMs,
        };
      }
      return result;
    },
  };
}
