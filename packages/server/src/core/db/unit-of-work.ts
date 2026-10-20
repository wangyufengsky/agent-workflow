import type { ServerEvent } from '@aw/shared';
import type { EventBus } from '../event-bus.ts';
import type { Db } from './database.ts';

/**
 * Transactions that span services (09 §1, 06 §9: a transition, its task event and the rows it creates commit
 * together). The database is one synchronous connection, so a transaction is ambient: repositories keep using the
 * database object, nested `transact` calls join the outer transaction, and events and follow-up work queued with
 * `publish` / `afterCommit` run only once it committed (never for rolled-back changes).
 */
export function createUnitOfWork(db: Db, events: EventBus) {
  let pending: Array<() => void> | undefined;

  return {
    /** Runs `work` (which must be synchronous) in one transaction, or in the surrounding one. */
    transact<T>(work: () => T): T {
      if (pending !== undefined) return work();
      const queued: Array<() => void> = [];
      pending = queued;
      let result: T;
      try {
        result = db.transaction(() => work());
      } finally {
        pending = undefined;
      }
      for (const run of queued) run();
      return result;
    },
    /** Publishes now, or after the surrounding transaction commits. */
    publish(event: ServerEvent): void {
      if (pending === undefined) events.publish(event);
      else pending.push(() => events.publish(event));
    },
    /** Runs `fn` now, or after the surrounding transaction commits. */
    afterCommit(fn: () => void): void {
      if (pending === undefined) fn();
      else pending.push(fn);
    },
  };
}
export type UnitOfWork = ReturnType<typeof createUnitOfWork>;
