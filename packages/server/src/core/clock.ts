/** Time source; injected so tests control timestamps and timeouts (07 §4). */
export type Clock = { now(): number };

export const systemClock: Clock = { now: () => Date.now() };
