import { AppError, ErrorCode, WorktreeStatus } from '@aw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { worktreesTable } from './worktrees.table.ts';

export type Worktree = typeof worktreesTable.$inferSelect;

export function createWorktreesRepo(db: DbExecutor) {
  return {
    insert(worktree: Worktree): void {
      db.insert(worktreesTable).values(worktree).run();
    },
    find(id: string): Worktree | undefined {
      return db.select().from(worktreesTable).where(eq(worktreesTable.id, id)).get();
    },
    listByStatus(status: WorktreeStatus): Worktree[] {
      return db.select().from(worktreesTable).where(eq(worktreesTable.status, status)).all();
    },
    listByProject(projectId: string): Worktree[] {
      return db.select().from(worktreesTable).where(eq(worktreesTable.projectId, projectId)).all();
    },
    listByTasks(taskIds: readonly string[]): Worktree[] {
      return taskIds.length === 0
        ? []
        : db
            .select()
            .from(worktreesTable)
            .where(inArray(worktreesTable.taskId, [...taskIds]))
            .all();
    },
    taskAt(path: string): string | undefined {
      return db
        .select({ taskId: worktreesTable.taskId })
        .from(worktreesTable)
        .where(and(eq(worktreesTable.path, path), eq(worktreesTable.status, WorktreeStatus.Ready)))
        .get()?.taskId;
    },
    findByTask(taskId: string): Worktree | undefined {
      return db.select().from(worktreesTable).where(eq(worktreesTable.taskId, taskId)).get();
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(
      id: string,
      from: WorktreeStatus,
      to: WorktreeStatus,
      changes: { error?: string; removedAt?: number | null } = {},
    ): void {
      const result = db
        .update(worktreesTable)
        .set({ status: to, ...changes })
        .where(and(eq(worktreesTable.id, id), eq(worktreesTable.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `worktree ${id} is no longer ${from}`, {
          entity: 'worktree',
          from,
          to,
        });
      }
    },
    delete(id: string): void {
      db.delete(worktreesTable).where(eq(worktreesTable.id, id)).run();
    },
  };
}
