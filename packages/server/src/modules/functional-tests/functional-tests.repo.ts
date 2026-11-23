import {
  type FunctionalTestEvent,
  type FunctionalTestSnapshot,
  functionalTestSnapshotSchema,
  ServerEventType,
} from '@aw/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import { functionalTestsTable as tests } from './functional-tests.table.ts';

export function createFunctionalTestRepo(db: Db, clock: Clock, unit: UnitOfWork) {
  function get(taskId: string): FunctionalTestSnapshot {
    const row = db.select().from(tests).where(eq(tests.taskId, taskId)).get();
    return row === undefined
      ? { cases: [], runs: [], executions: [], events: [], reports: [], nextAfter: 0 }
      : functionalTestSnapshotSchema.parse(JSON.parse(row.snapshot));
  }
  function update<T>(taskId: string, mutate: (snapshot: FunctionalTestSnapshot) => T): T {
    return unit.transact(() => {
      const snapshot = get(taskId);
      const result = mutate(snapshot);
      const encoded = JSON.stringify(snapshot);
      db.insert(tests)
        .values({ taskId, snapshot: encoded })
        .onConflictDoUpdate({ target: tests.taskId, set: { snapshot: encoded } })
        .run();
      unit.publish({ type: ServerEventType.FunctionalTestUpdated, data: { taskId, after: snapshot.nextAfter } });
      return result;
    });
  }
  function event(
    snapshot: FunctionalTestSnapshot,
    event: Pick<FunctionalTestEvent, 'kind' | 'message' | 'detail'> &
      Partial<Pick<FunctionalTestEvent, 'runId' | 'caseId' | 'executionId' | 'step'>>,
  ): void {
    const { runId = null, caseId = null, executionId = null, step = null, ...rest } = event;
    snapshot.events.push({ seq: ++snapshot.nextAfter, at: clock.now(), runId, caseId, executionId, step, ...rest });
  }
  return { get, update, event, keys: () => db.select({ taskId: tests.taskId }).from(tests).all() };
}
export type FunctionalTestRepo = ReturnType<typeof createFunctionalTestRepo>;
