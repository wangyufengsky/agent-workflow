import { emphasisRuns } from './geometry.ts';
import styles from './slide.module.css';

/** Page text with its `**…**` runs in the accent colour. */
export function Emphasis({ text }: { text: string }) {
  return (
    <>
      {emphasisRuns(text).map((run, i) =>
        run.strong ? (
          // Runs are positional and never reordered.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <strong key={i} className={styles.em}>
            {run.text}
          </strong>
        ) : (
          run.text
        ),
      )}
    </>
  );
}
