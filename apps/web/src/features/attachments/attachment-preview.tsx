import type { AttachmentDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { attachmentContentQuery, attachmentQuery } from './attachments.api.ts';
import styles from './attachments.module.css';

const describe = ({ origin, sizeBytes }: AttachmentDTO) => {
  const source =
    origin === null
      ? C.fromUpload
      : C.fromProject(origin.lines === null ? origin.path : `${origin.path}:${origin.lines.from}-${origin.lines.to}`);
  return `${source} · ${C.size(sizeBytes)}`;
};

/** What was attached, exactly as saved: the text the AI reads (30 §3). */
export function AttachmentPreview({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const meta = useQuery(attachmentQuery(id));
  const content = useQuery(attachmentContentQuery(id));
  const error = meta.error ?? content.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={name}
      {...(meta.data === undefined ? {} : { description: describe(meta.data) })}
      footer={<Button onClick={onClose}>{C.close}</Button>}
    >
      {content.isPending && <p className="hint">{C.loading}</p>}
      {error !== null && <ErrorState error={error} />}
      {content.data !== undefined && <pre className={`mono ${styles.preview}`}>{content.data}</pre>}
    </Dialog>
  );
}
