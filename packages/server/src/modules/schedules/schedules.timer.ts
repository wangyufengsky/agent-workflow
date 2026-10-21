import { SCHEDULE_CHECK_INTERVAL_MS } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';

export type ScheduleTimerDeps = {
  clock: Clock;
  log: Logger;
  /** When the earliest active schedule is next due. */
  nextDue: () => number | undefined;
  /** Runs every due schedule once. */
  runDue: () => Promise<void>;
};

/**
 * Wakes up when the next schedule is due, but at least every `SCHEDULE_CHECK_INTERVAL_MS`: timers stand still while
 * the computer sleeps and the system time may be changed, so waiting the whole way could be far too late (22 §4).
 */
export function createScheduleTimer({ clock, log, nextDue, runDue }: ScheduleTimerDeps) {
  let started = false;
  let cancel: (() => void) | undefined;
  let checking: Promise<void> | undefined;

  function arm(): void {
    cancel?.();
    cancel = undefined;
    // A check in progress arms the timer when it ends.
    if (!started || checking !== undefined) return;
    const due = nextDue();
    const wait =
      due === undefined
        ? SCHEDULE_CHECK_INTERVAL_MS
        : Math.min(Math.max(due - clock.now(), 0), SCHEDULE_CHECK_INTERVAL_MS);
    cancel = clock.schedule(wait, check);
  }

  function check(): void {
    cancel = undefined;
    checking = (async () => {
      try {
        await runDue();
      } catch (err) {
        // A defect in one check must not stop every schedule: it is logged for a person and the next check runs.
        log.error({ err }, 'schedule tick failed');
      } finally {
        checking = undefined;
        arm();
      }
    })();
  }

  return {
    start(): void {
      started = true;
      arm();
    },
    stop(): void {
      started = false;
      arm();
    },
    /** Schedules changed: when the next one is due may have too. */
    rearm: arm,
    /** Resolves once the check in progress, if any, ended (tests advance a FakeClock and wait for it). */
    settled: async (): Promise<void> => {
      await checking;
    },
  };
}
export type ScheduleTimer = ReturnType<typeof createScheduleTimer>;
