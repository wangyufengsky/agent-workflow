import type { Clock } from '../../core/clock.ts';

/** Requests that stay open by design: a page using them would never look quiet. */
const LONG_LIVED = new Set(['EventSource', 'WebSocket']);

/**
 * Whether a tab's network has been quiet (no request in flight) for `quietMs` (29 §5.5), fed with its CDP Network
 * events. `whenQuiet` resolves true once it is, or false after `timeoutMs`.
 */
export function createNetworkTracker(clock: Clock, quietMs: number) {
  const inFlight = new Set<string>();
  let lastChange = clock.now();
  const waiters = new Set<() => void>();
  const changed = () => {
    lastChange = clock.now();
    for (const check of waiters) check();
  };
  return {
    onEvent(method: string, params: { requestId?: string; type?: string }): void {
      if (params.requestId === undefined) return;
      if (method === 'Network.requestWillBeSent' && !LONG_LIVED.has(params.type ?? '')) {
        inFlight.add(params.requestId);
        changed();
      } else if (
        (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') &&
        inFlight.delete(params.requestId)
      ) {
        changed();
      }
    },
    whenQuiet(timeoutMs: number): Promise<boolean> {
      return new Promise((resolve) => {
        let cancelQuiet = () => {};
        const finish = (quiet: boolean) => {
          waiters.delete(check);
          cancelQuiet();
          cancelTimeout();
          resolve(quiet);
        };
        const check = () => {
          cancelQuiet();
          if (inFlight.size > 0) return;
          const wait = Math.max(0, lastChange + quietMs - clock.now());
          cancelQuiet = clock.schedule(wait, () => finish(true));
        };
        const cancelTimeout = clock.schedule(timeoutMs, () => finish(false));
        waiters.add(check);
        check();
      });
    },
  };
}
export type NetworkTracker = ReturnType<typeof createNetworkTracker>;
