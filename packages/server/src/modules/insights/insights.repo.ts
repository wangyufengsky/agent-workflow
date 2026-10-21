import {
  AttemptKind,
  errorInfoSchema,
  InboxKind,
  NodeEvent,
  questionResponseSchema,
  TaskEventEntity,
  TaskStatus,
} from '@aw/shared';
import { and, eq, gte, inArray, isNotNull, lt, min, or } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { attemptsTable } from '../attempts/index.ts';
import { inboxItemsTable } from '../inbox/index.ts';
import { knowledgeConversationsTable, knowledgeTurnsTable } from '../knowledge/index.ts';
import { nodesTable } from '../nodes/index.ts';
import { projectsTable } from '../projects/index.ts';
import { rolesTable } from '../roles/index.ts';
import { tasksTable } from '../tasks/index.ts';
import { taskEventsTable } from '../timeline/index.ts';
import { workflowsTable } from '../workflows/index.ts';
import type { EndedTask, InsightsData, UsageAttempt } from './insights.aggregate.ts';

const ENDED_STATUSES = [TaskStatus.Completed, TaskStatus.Cancelled, TaskStatus.Failed] as const;
const isEnded = (s: TaskStatus): s is EndedTask['status'] => ENDED_STATUSES.some((e) => e === s);

/**
 * The rows 19 §2 counts, read-only: by time range (indexed, 19 §5) for usage, ended tasks and interruptions, then by
 * the ended tasks' ids, one query per table (06 §9).
 */
export function createInsightsRepo(db: DbExecutor) {
  const a = attemptsTable;
  const inRange = (column: typeof a.startedAt, start: number, end: number) => and(gte(column, start), lt(column, end));

  /** Workflow names by key, from each workflow's latest version. */
  function latestWorkflowNames(): Map<string, string> {
    const rows = db
      .select({ key: workflowsTable.key, name: workflowsTable.name, version: workflowsTable.version })
      .from(workflowsTable)
      .all()
      .sort((x, y) => x.version - y.version);
    return new Map(rows.map((r) => [r.key, r.name]));
  }

  function usage(start: number, end: number): UsageAttempt[] {
    const usageColumns = {
      kind: a.kind,
      roleKey: rolesTable.key,
      roleName: rolesTable.name,
      model: a.model,
      tokensInput: a.tokensInput,
      tokensOutput: a.tokensOutput,
      startedAt: a.startedAt,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
    };
    const names = latestWorkflowNames();
    const ofTasks = db
      .select({ ...usageColumns, taskId: tasksTable.id, workflowKey: workflowsTable.key })
      .from(a)
      .innerJoin(tasksTable, eq(tasksTable.id, a.taskId))
      .innerJoin(projectsTable, eq(projectsTable.id, tasksTable.projectId))
      .innerJoin(workflowsTable, eq(workflowsTable.id, tasksTable.workflowId))
      .leftJoin(rolesTable, eq(rolesTable.id, a.roleId))
      .where(inRange(a.startedAt, start, end))
      .all()
      .map((row) => {
        const workflowName = names.get(row.workflowKey);
        if (workflowName === undefined) throw new Error(`No workflow ${row.workflowKey}`);
        return { ...row, workflowName };
      });
    // Debug attempts (development builds) belong to neither a task nor a knowledge question: not counted.
    const ofQuestions = db
      .select(usageColumns)
      .from(a)
      .innerJoin(knowledgeTurnsTable, eq(knowledgeTurnsTable.attemptId, a.id))
      .innerJoin(knowledgeConversationsTable, eq(knowledgeConversationsTable.id, knowledgeTurnsTable.conversationId))
      .innerJoin(projectsTable, eq(projectsTable.id, knowledgeConversationsTable.projectId))
      .leftJoin(rolesTable, eq(rolesTable.id, a.roleId))
      .where(and(eq(a.kind, AttemptKind.Research), inRange(a.startedAt, start, end)))
      .all()
      .map((row) => ({ ...row, taskId: null, workflowKey: null, workflowName: null }));
    return [...ofTasks, ...ofQuestions];
  }

  function endedTasks(start: number, end: number): EndedTask[] {
    const t = tasksTable;
    // `updated_at` is at least the end time, so the status index narrows the scan before the end time is known.
    const rows = db
      .select({ id: t.id, status: t.status, startedAt: t.startedAt, finishedAt: t.finishedAt, updatedAt: t.updatedAt })
      .from(t)
      .where(and(inArray(t.status, ENDED_STATUSES), gte(t.updatedAt, start)))
      .all();
    const ended = rows.flatMap((row) => {
      const { status } = row;
      if (!isEnded(status)) return [];
      // A failed task changes again only by retrying or cancelling, both of which change its status (19 §2.4).
      const endedAt = status === TaskStatus.Failed ? row.updatedAt : row.finishedAt;
      if (endedAt === null) throw new Error(`Task ${row.id} is ${status} without a finish time`);
      return endedAt >= start && endedAt < end ? [{ id: row.id, status, endedAt, startedAt: row.startedAt }] : [];
    });
    const ids = ended.map((e) => e.id);
    const reviewAt = new Map(
      ids.length === 0
        ? []
        : db
            .select({ taskId: taskEventsTable.taskId, at: min(taskEventsTable.createdAt) })
            .from(taskEventsTable)
            .where(
              and(
                inArray(taskEventsTable.taskId, ids),
                eq(taskEventsTable.entity, TaskEventEntity.Task),
                eq(taskEventsTable.toStatus, TaskStatus.Review),
              ),
            )
            .groupBy(taskEventsTable.taskId)
            .all()
            .map((r) => [r.taskId, r.at]),
    );
    return ended.map((e) => ({ ...e, reviewAt: reviewAt.get(e.id) ?? null }));
  }

  function interruptions(taskIds: string[], start: number, end: number): InsightsData['interruptions'] {
    const i = inboxItemsTable;
    const rows = db
      .select({ id: i.id, kind: i.kind, taskId: i.taskId, createdAt: i.createdAt, response: i.response })
      .from(i)
      .where(
        and(
          inArray(i.kind, [InboxKind.Question, InboxKind.Permission]),
          or(
            and(gte(i.createdAt, start), lt(i.createdAt, end)),
            taskIds.length === 0 ? undefined : inArray(i.taskId, taskIds),
          ),
        ),
      )
      .all();
    return rows.map((row) => ({
      taskId: row.taskId,
      createdAt: row.createdAt,
      // JSON column: parsed at the boundary (06 §9).
      assumed:
        row.kind === InboxKind.Question &&
        row.response !== null &&
        'assumed' in questionResponseSchema.parse(JSON.parse(row.response)),
    }));
  }

  return {
    read(start: number, end: number): InsightsData {
      const ended = endedTasks(start, end);
      const ids = ended.map((t) => t.id);
      const byTasks = ids.length > 0;
      return {
        usage: usage(start, end),
        ended,
        nodes: byTasks
          ? db
              .select({ id: nodesTable.id, taskId: nodesTable.taskId, status: nodesTable.status })
              .from(nodesTable)
              .where(inArray(nodesTable.taskId, ids))
              .all()
          : [],
        executeAttempts: byTasks
          ? db
              .select({ taskId: a.taskId, nodeId: a.nodeId, status: a.status, error: a.error })
              .from(a)
              .where(and(inArray(a.taskId, ids), eq(a.kind, AttemptKind.Execute), isNotNull(a.nodeId)))
              .all()
              .map((row) => {
                if (row.taskId === null || row.nodeId === null) throw new Error('execute attempt without a node');
                return {
                  taskId: row.taskId,
                  nodeId: row.nodeId,
                  status: row.status,
                  errorCode: row.error === null ? null : errorInfoSchema.parse(JSON.parse(row.error)).code,
                };
              })
          : [],
        nodeEvents: byTasks
          ? db
              .select({ taskId: taskEventsTable.taskId, type: taskEventsTable.type })
              .from(taskEventsTable)
              .where(
                and(
                  inArray(taskEventsTable.taskId, ids),
                  eq(taskEventsTable.entity, TaskEventEntity.Node),
                  inArray(taskEventsTable.type, [NodeEvent.ChecksFailed, NodeEvent.Reject]),
                ),
              )
              .all()
          : [],
        interruptions: interruptions(ids, start, end),
      };
    },
  };
}
