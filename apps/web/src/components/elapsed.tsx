import { useEffect, useState } from 'react';
import { TASK_COPY as C } from '../copy/tasks.ts';

/** Minutes are shown, so the clock moves every half minute. */
const TICK_MS = 30_000;

/** How long something has been going since `since` (epoch ms), kept current while shown (D118). */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <>{C.elapsed(Math.max(0, now - since))}</>;
}
