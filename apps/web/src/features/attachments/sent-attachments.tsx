import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { AttachmentPreview } from './attachment-preview.tsx';
import styles from './attachments.module.css';
import { FileName } from './file-name.tsx';

type Sent = { id: string; name: string };

/** Attachments already sent with a task or a message; each opens to show what the AI read. */
export function SentAttachments({ attachments }: { attachments: readonly Sent[] }) {
  const [open, setOpen] = useState<Sent>();
  return (
    <>
      <ul className={styles.list} aria-label={C.listLabel}>
        {attachments.map((a) => (
          <li key={a.id}>
            <button type="button" className={styles.card} aria-label={C.open(a.name)} onClick={() => setOpen(a)}>
              <Icon name="file" size="sm" />
              <FileName name={a.name} />
            </button>
          </li>
        ))}
      </ul>
      {open !== undefined && <AttachmentPreview id={open.id} name={open.name} onClose={() => setOpen(undefined)} />}
    </>
  );
}
