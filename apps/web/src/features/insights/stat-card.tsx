import type { ReactNode } from 'react';
import styles from './insights.module.css';

/** One figure: a button when it drills into the tasks behind it (19 §3.2). */
export function StatCard({
  label,
  value,
  sub,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub !== undefined && <span className={styles.statSub}>{sub}</span>}
    </>
  );
  return onOpen === undefined ? (
    <div className={`card ${styles.stat}`}>{body}</div>
  ) : (
    <button type="button" className={`card hoverable ${styles.stat}`} onClick={onOpen}>
      {body}
    </button>
  );
}
