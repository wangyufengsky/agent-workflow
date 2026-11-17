import {
  AppError,
  ARTIFACT_WORKFLOW_KEY,
  browserCaseSchema,
  type Checkpoints,
  checkpointsSchema,
  ErrorCode,
  type ErrorInfo,
  errorInfoSchema,
  type SkillSnapshot,
  skillSnapshotsSchema,
  type TaskResultDTO,
  type TaskStatus,
  taskResultSchema,
} from '@aw/shared';
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectsTable } from '../projects/index.ts';
import { workflowsTable } from '../workflows/index.ts';
import { appCountersTable, tasksTable } from './tasks.table.ts';

const TASK_SEQ_COUNTER = 'task_seq';

const { skills: skillColumn, ...taskColumns } = getTableColumns(tasksTable);
type TaskRow = Omit<typeof tasksTable.$inferSelect, 'skills'>;

/** A task with its JSON columns parsed and the names of its project and workflow. */
export type Task = Omit<TaskRow, 'failure' | 'checkpoints' | 'result'> & {
  failure: ErrorInfo | null;
  checkpoints: Checkpoints;
  result: TaskResultDTO | null;
  projectName: string;
  workflowKey: string;
  workflowName: string;
};

/** Columns a transition may change together with the status. */
export type TaskChanges = Partial<
  Pick<
    TaskRow,
    'failedPhase' | 'baseCommit' | 'branch' | 'currentPlanId' | 'startedAt' | 'finishedAt' | 'archivedAt'
  > & {
    failure: ErrorInfo | null;
    result: TaskResultDTO;
  }
>;

export type NewTask = Pick<
  TaskRow,
  | 'id'
  | 'projectId'
  | 'workflowId'
  | 'title'
  | 'requirement'
  | 'browserTest'
  | 'browserCase'
  | 'status'
  | 'baseBranch'
  | 'mergeSource'
  | 'createdAt'
  | 'updatedAt'
> & { checkpoints: Checkpoints; skills: SkillSnapshot[] };

// JSON columns: parsed at the boundary (06 §9).
function toTask(row: { tasks: TaskRow; projectName: string; workflowKey: string; workflowName: string }): Task {
  const { tasks: t, ...names } = row;
  return {
    ...t,
    ...names,
    browserCase: t.browserCase === null ? null : browserCaseSchema.parse(t.browserCase),
    failure: t.failure === null ? null : errorInfoSchema.parse(JSON.parse(t.failure)),
    checkpoints: checkpointsSchema.parse(JSON.parse(t.checkpoints)),
    result: t.result === null ? null : taskResultSchema.parse(JSON.parse(t.result)),
  };
}

function serialize(changes: TaskChanges) {
  const { failure, result, ...rest } = changes;
  return {
    ...rest,
    ...(failure === undefined ? {} : { failure: failure === null ? null : JSON.stringify(failure) }),
    ...(result === undefined ? {} : { result: JSON.stringify(result) }),
  };
}

/** A task status, and whether the task must (`with`) or must not (`without`) have open attention items. */
export type StatusMatch = {
  status: TaskStatus;
  attention: 'with' | 'without' | 'any';
  frontendIteration?: boolean;
  artifactIteration?: boolean;
};

/** 正文只在启动会话和读取任务详情时需要，任务列表不加载它。 */
export function readTaskSkills(db: DbExecutor, id: string): SkillSnapshot[] {
  const row = db.select({ skills: skillColumn }).from(tasksTable).where(eq(tasksTable.id, id)).get();
  if (row === undefined) throw new AppError(ErrorCode.TaskNotFound, `Task ${id} not found`, { id });
  return skillSnapshotsSchema.parse(JSON.parse(row.skills));
}

export function createTasksRepo(db: DbExecutor) {
  const t = tasksTable;
  const select = (where: SQL | undefined) =>
    db
      .select({
        tasks: taskColumns,
        projectName: projectsTable.name,
        workflowKey: workflowsTable.key,
        workflowName: workflowsTable.name,
      })
      .from(t)
      .innerJoin(projectsTable, eq(projectsTable.id, t.projectId))
      .innerJoin(workflowsTable, eq(workflowsTable.id, t.workflowId))
      .where(where);

  return {
    /** Numbers the task `T-<seq>` with a number never handed out before, deleted tasks' included (D223), and inserts it. */
    insert(task: NewTask, keyPrefix: string): void {
      const c = appCountersTable;
      const { value: seq } = db
        .insert(c)
        .values({ name: TASK_SEQ_COUNTER, value: 1 })
        .onConflictDoUpdate({ target: c.name, set: { value: sql`${c.value} + 1` } })
        .returning({ value: c.value })
        .get();
      db.insert(t)
        .values({
          ...task,
          seq,
          key: `${keyPrefix}${seq}`,
          checkpoints: JSON.stringify(task.checkpoints),
          skills: JSON.stringify(task.skills),
        })
        .run();
    },
    find(id: string): Task | undefined {
      const row = select(eq(t.id, id)).get();
      return row === undefined ? undefined : toTask(row);
    },
    /** Most recently updated first. */
    list(filter: { projectId?: string; statuses?: readonly TaskStatus[]; ids?: readonly string[] }): Task[] {
      return select(
        and(
          ...(filter.projectId === undefined ? [] : [eq(t.projectId, filter.projectId)]),
          ...(filter.ids === undefined ? [] : [inArray(t.id, filter.ids)]),
          ...(filter.statuses === undefined ? [] : [inArray(t.status, filter.statuses)]),
        ),
      )
        .orderBy(desc(t.updatedAt), desc(t.seq))
        .all()
        .map(toTask);
    },
    /** The workflow versions among `ids` that some task uses. */
    workflowsInUse(ids: readonly string[]): Set<string> {
      if (ids.length === 0) return new Set();
      return new Set(
        db
          .select({ id: t.workflowId })
          .from(t)
          .where(inArray(t.workflowId, ids))
          .all()
          .map((r) => r.id),
      );
    },
    /**
     * One page of the list, most recently updated first (11 §1): `after` is where the previous page ended. `oneOf`
     * keeps tasks that match any entry: a status, and whether the task is in `attention` (or either).
     */
    page(filter: {
      projectId: string | undefined;
      archived: boolean;
      oneOf: readonly StatusMatch[] | undefined;
      attention: ReadonlySet<string>;
      after: { updatedAt: number; seq: number } | undefined;
      limit: number;
    }): Task[] {
      const ids = [...filter.attention];
      const statusMatch = filter.oneOf?.flatMap(({ status, attention, frontendIteration, artifactIteration }) => {
        if (attention === 'with' && ids.length === 0) return [];
        const reviewed = sql`json_extract(${t.result}, '$.frontendVerified')`;
        const iteration =
          frontendIteration === undefined
            ? undefined
            : frontendIteration
              ? sql`${reviewed} IS 0`
              : sql`${reviewed} IS NOT 0`;
        const required =
          attention === 'with'
            ? inArray(t.id, ids)
            : attention === 'without' && ids.length > 0
              ? notInArray(t.id, ids)
              : undefined;
        const artifact =
          artifactIteration === undefined
            ? undefined
            : sql`(${workflowsTable.key} = ${ARTIFACT_WORKFLOW_KEY}) = ${artifactIteration ? 1 : 0}`;
        return [and(eq(t.status, status), required, iteration, artifact)];
      });
      const { after } = filter;
      return select(
        and(
          ...(filter.projectId === undefined ? [] : [eq(t.projectId, filter.projectId)]),
          filter.archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt),
          // No status can match: an empty page, not every task.
          ...(statusMatch === undefined ? [] : [statusMatch.length === 0 ? sql`0` : or(...statusMatch)]),
          ...(after === undefined
            ? []
            : [or(lt(t.updatedAt, after.updatedAt), and(eq(t.updatedAt, after.updatedAt), lt(t.seq, after.seq)))]),
        ),
      )
        .orderBy(desc(t.updatedAt), desc(t.seq))
        .limit(filter.limit)
        .all()
        .map(toTask);
    },
    update(id: string, changes: TaskChanges & { updatedAt: number }): void {
      db.update(t).set(serialize(changes)).where(eq(t.id, id)).run();
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(id: string, from: TaskStatus, to: TaskStatus, changes: TaskChanges & { updatedAt: number }): void {
      const result = db
        .update(t)
        .set({ status: to, ...serialize(changes) })
        .where(and(eq(t.id, id), eq(t.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `task ${id} is no longer ${from}`, {
          entity: 'task',
          from,
          to,
        });
      }
    },
    /** Archives or brings back a task; its `updatedAt` stays, since nothing about the work changed (D218). */
    setArchived(id: string, archivedAt: number | null): void {
      db.update(t).set({ archivedAt }).where(eq(t.id, id)).run();
    },
    /** Finished tasks not archived yet, of one project or all (D220). */
    unarchivedIn(projectId: string | undefined, statuses: readonly TaskStatus[]): string[] {
      return db
        .select({ id: t.id })
        .from(t)
        .where(
          and(
            ...(projectId === undefined ? [] : [eq(t.projectId, projectId)]),
            inArray(t.status, statuses),
            isNull(t.archivedAt),
          ),
        )
        .all()
        .map((r) => r.id);
    },
    archiveAll(ids: readonly string[], archivedAt: number): void {
      if (ids.length > 0) db.update(t).set({ archivedAt }).where(inArray(t.id, ids)).run();
    },
    delete(id: string): void {
      db.delete(t).where(eq(t.id, id)).run();
    },
    deleteByProject(projectId: string): void {
      db.delete(t).where(eq(t.projectId, projectId)).run();
    },
  };
}
