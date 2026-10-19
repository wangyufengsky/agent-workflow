/** Time source; injected so tests control timestamps and timeouts without waiting (07 §4). */
export type Clock = {
  now(): number;
  /** Runs `fn` once after `ms`; returns a function that cancels it. */
  schedule(ms: number, fn: () => void): () => void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(ms, fn) {
    // Timers guard work that is already in flight; they alone must not keep the process alive.
    const timer = setTimeout(fn, ms).unref();
    return () => clearTimeout(timer);
  },
};
