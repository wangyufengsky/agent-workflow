import type { AssistantConfirmationStatus, AssistantTurnEvent, AssistantTurnStatus } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';
import { teamAnalysesTable } from '../team/team.table.ts';

/** 10 §4 assistant_conversations: one opencode session each, created with the first message. */
export const assistantConversationsTable = sqliteTable(
  'assistant_conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    opencodeSessionId: text('opencode_session_id'),
    /** 旧会话目录不可由 opencode 请求参数改变，首次恢复时迁到独立会话。 */
    isolated: integer('isolated', { mode: 'boolean' }).notNull().default(false),
    retiredSessionId: text('retired_session_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('assistant_conversations_session_idx').on(t.opencodeSessionId),
    index('assistant_conversations_updated_idx').on(t.updatedAt),
  ],
);

/** 10 §4 assistant_confirmations: a write or critical call waiting for the user (15 §4). */
export const assistantConfirmationsTable = sqliteTable(
  'assistant_confirmations',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    /** JSON: the input the operation runs with. */
    input: text('input').notNull(),
    status: text('status').$type<AssistantConfirmationStatus>().notNull(),
    /** JSON `AssistantConfirmationResult`, once confirmed. */
    result: text('result'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('assistant_confirmations_conversation_idx').on(t.conversationId, t.createdAt)],
);

/** 待回传的应用消息：确认结果和入队在同一事务提交，模型接受后才移除。 */
export const assistantOutboxTable = sqliteTable(
  'assistant_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('assistant_outbox_conversation_idx').on(t.conversationId, t.id)],
);

/** 任务归属与消费游标；任务或原对话删除时停止跟进。 */
export const assistantTaskFollowupsTable = sqliteTable(
  'assistant_task_followups',
  {
    taskId: text('task_id')
      .primaryKey()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    lastEventId: integer('last_event_id').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('assistant_task_followups_conversation_idx').on(t.conversationId)],
);

/** 助手发起的成员分析（33 §6）：结束后把报告发回发起它的对话；分析或对话删除时停止跟进。 */
export const assistantAnalysisFollowupsTable = sqliteTable(
  'assistant_analysis_followups',
  {
    analysisId: text('analysis_id')
      .primaryKey()
      .references(() => teamAnalysesTable.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    /** The report (or the failure) was queued to the conversation. */
    reported: integer('reported', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('assistant_analysis_followups_conversation_idx').on(t.conversationId)],
);

/** 每次外部发送前持久化，未报告 tokens 保持 NULL；结束只能经助手轮次状态机。 */
export const assistantTurnsTable = sqliteTable(
  'assistant_turns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    source: text('source').$type<'user' | 'app'>().notNull(),
    status: text('status').$type<AssistantTurnStatus>().notNull(),
    endReason: text('end_reason').$type<AssistantTurnEvent>(),
    model: text('model'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    elapsedMs: integer('elapsed_ms'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    timeoutMs: integer('timeout_ms').notNull(),
    /** JSON：跨重放识别已记录的步骤，以及将迟到用量归回原轮次。 */
    messageIds: text('message_ids').notNull(),
    stepIds: text('step_ids').notNull(),
  },
  (t) => [
    index('assistant_turns_conversation_idx').on(t.conversationId, t.startedAt),
    index('assistant_turns_status_idx').on(t.status),
  ],
);
