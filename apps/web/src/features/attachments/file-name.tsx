import styles from './attachments.module.css';

/** A file name on one line that keeps its extension when it does not fit (30 §2); the full name is the hover hint. */
export function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  const cut = dot > 0 ? dot : name.length;
  return (
    <span className={styles.fileName} title={name}>
      <span className={styles.fileBase}>{name.slice(0, cut)}</span>
      <span className={styles.fileExt}>{name.slice(cut)}</span>
    </span>
  );
}
