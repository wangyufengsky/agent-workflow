import { BATCH_TARGET_PLACEHOLDER } from '@aw/shared';
import { Fragment } from 'react';
import { BATCHES_COPY as C } from '../../copy/batches.ts';
import styles from './batches.module.css';

/** A batch title or template with each `{{target}}` shown as a「目标」tag (20 §2). */
export function TemplateText({ text }: { text: string }) {
  const parts = text.split(BATCH_TARGET_PLACEHOLDER);
  return parts.map((part, i) => (
    // The parts of one text never move, so their position is their identity.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <span className={styles.placeholder}>{C.placeholderChip}</span>}
    </Fragment>
  ));
}
