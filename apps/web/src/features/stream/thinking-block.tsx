import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { STREAM_COPY as C } from '../../copy/attempts.ts';
import styles from './stream.module.css';

/**
 * One part of the model's reasoning (25 §4.2): folded to how long it took and its first line; while it is being
 * written, its last lines show with a caret. The text is the model's own, untranslated.
 */
export function ThinkingBlock({
  text,
  seconds,
  writing,
}: {
  text: string;
  /** How long it took; unknown for a part of a conversation read without timestamps. */
  seconds: number | undefined;
  writing: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (writing)
    return (
      <div className={styles.thinking} data-writing="true" data-testid="stream-thinking">
        <div className={styles.thinkingHead}>
          <span className={styles.thinkingIcon} aria-hidden="true">
            <Icon name="sparkle" size="sm" />
          </span>
          <span className="shimmer" role="status">
            {C.thinking}
          </span>
        </div>
        <div className={styles.thinkingTail}>
          <p>
            {text}
            <span className="caret" aria-hidden="true" />
          </p>
        </div>
      </div>
    );
  const first = text.trim().split('\n')[0];
  return (
    <div className={styles.thinking} data-testid="stream-thinking">
      <button type="button" className={styles.thinkingHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.thinkingIcon} aria-hidden="true">
          <Icon name="sparkle" size="sm" />
        </span>
        <span className={styles.thinkingLabel}>{seconds === undefined ? C.thinkingDone : C.thought(seconds)}</span>
        {!open && <span className={styles.thinkingPreview}>{first}</span>}
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevRight" size="sm" />
        </span>
      </button>
      {open && <p className={styles.thinkingBody}>{text}</p>}
    </div>
  );
}
