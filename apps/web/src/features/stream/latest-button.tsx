import { Icon } from '../../components/icon.tsx';
import { STREAM_COPY as C } from '../../copy/attempts.ts';
import styles from './stream.module.css';

/** 「回到最新」once the user scrolled up a following stream (25 §4.1); sits at the bottom of the nearest positioned box. */
export function LatestButton({ unseen, onClick }: { unseen: number; onClick(): void }) {
  return (
    <button type="button" className={styles.latest} onClick={onClick}>
      <Icon name="arrowDown" size="sm" />
      {C.latest}
      {unseen > 0 && <span className={styles.unseen}> · {C.unseen(unseen)}</span>}
    </button>
  );
}
