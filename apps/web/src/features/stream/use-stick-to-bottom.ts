import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Within this many pixels of the bottom the stream counts as at the bottom and keeps following. */
const BOTTOM_SLACK_PX = 48;

/**
 * Keeps a scrolling box at its newest content while the user is at the bottom (25 §4.1). Scrolling up stops it;
 * `unseen` counts the items added since, and `toLatest` scrolls back down and follows again. `version` changes whenever
 * the content grows (a new item or longer text); `count` is the number of items.
 */
export function useStickToBottom(version: string, count: number) {
  const ref = useRef<HTMLDivElement>(null);
  // Items there were when the user scrolled away from the bottom; null while following.
  const [leftAt, setLeftAt] = useState<number | null>(null);
  const following = leftAt === null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows whenever the content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null && following) el.scrollTop = el.scrollHeight;
  }, [version, following]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    setLeftAt((at) => (atBottom ? null : (at ?? count)));
  }, [count]);

  // Following again scrolls down (the effect above); a smooth scroll would report positions above the bottom.
  const toLatest = useCallback(() => setLeftAt(null), []);

  return { ref, onScroll, following, unseen: leftAt === null ? 0 : Math.max(0, count - leftAt), toLatest };
}
