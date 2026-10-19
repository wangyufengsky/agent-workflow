import type { Clock } from '../../src/core/clock.ts';

type Timer = { at: number; fn: () => void };

/** Manually advanced clock (07 §4): timeouts fire when the test moves time past them, never by waiting. */
export function createFakeClock(start = 1_760_000_000_000) {
  let now = start;
  const timers = new Set<Timer>();
  const clock: Clock & { advance(ms: number): void } = {
    now: () => now,
    schedule(ms, fn) {
      const timer = { at: now + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    /** Moves time forward and runs every timer that falls due, in order. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers.delete(due);
        now = due.at;
        due.fn();
      }
      now = until;
    },
  };
  return clock;
}
export type FakeClock = ReturnType<typeof createFakeClock>;
