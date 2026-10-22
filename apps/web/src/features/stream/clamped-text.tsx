import { useLayoutEffect, useRef, useState } from 'react';
import { STREAM_COPY as C } from '../../copy/attempts.ts';
import styles from './stream.module.css';

/**
 * Text folded to its first `lines` lines (25 §4.4), with「展开全部」only when it is longer than that. Wraps anywhere,
 * so long paths and URLs never leave their box.
 */
export function ClampedText({
  text,
  lines,
  className,
}: {
  text: string;
  lines: number;
  className: string | undefined;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures again when the text changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p
        ref={ref}
        className={`${styles.clamped} ${className ?? ''}`}
        data-open={open}
        style={{ WebkitLineClamp: lines }}
      >
        {text}
      </p>
      {(long || open) && (
        <button type="button" className={styles.more} onClick={() => setOpen(!open)}>
          {open ? C.less : C.more}
        </button>
      )}
    </div>
  );
}
