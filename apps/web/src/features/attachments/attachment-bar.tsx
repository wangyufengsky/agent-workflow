import { type ClipboardEvent, type DragEvent, useRef, useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { AttachmentPreview } from './attachment-preview.tsx';
import styles from './attachments.module.css';
import { FileName } from './file-name.tsx';
import { ProjectFileDialog, type ProjectFileSource } from './project-file-dialog.tsx';
import type { AttachmentDraft, DraftAttachment } from './use-attachment-draft.ts';

/** Drop targets of an input with attachments: files dropped anywhere on it are attached (30 §2). */
export function dropFilesInto(draft: AttachmentDraft) {
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  return {
    onDragOver: (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      draft.addFiles([...e.dataTransfer.files]);
    },
  };
}

/** Pasted files become attachments; pasted text goes into the input as before (30 §2). */
export function pasteFilesInto(draft: AttachmentDraft) {
  return (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    draft.addFiles(files);
  };
}

/**
 * The attachments of an input (30 §2): cards for what is attached, and「添加资料」. With a `projectFiles` source the
 * user can also pick a file of the project.
 */
export function AttachmentBar({
  draft,
  projectFiles,
}: {
  draft: AttachmentDraft;
  projectFiles?: ProjectFileSource | undefined;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<{ id: string; name: string }>();
  return (
    <div className={styles.bar}>
      {draft.items.length > 0 && (
        <ul className={styles.list} aria-label={C.listLabel}>
          {draft.items.map((item) => (
            <DraftCard key={item.key} item={item} onOpen={setOpen} onRemove={() => draft.remove(item.key)} />
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.add} onClick={() => picker.current?.click()}>
          <Icon name="paperclip" size="sm" />
          {C.add}
        </button>
        {projectFiles !== undefined && (
          <button type="button" className={styles.add} onClick={() => setPicking(true)}>
            <Icon name="folder" size="sm" />
            {C.addProjectFile}
          </button>
        )}
        {draft.notice !== undefined && (
          <span className="hint" role="status">
            {draft.notice}
          </span>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            draft.addFiles([...(e.target.files ?? [])]);
            // The same file can be picked again after it was removed.
            e.target.value = '';
          }}
        />
      </div>
      {picking && projectFiles !== undefined && (
        <ProjectFileDialog source={projectFiles} onAdd={draft.addProjectFile} onClose={() => setPicking(false)} />
      )}
      {open !== undefined && <AttachmentPreview id={open.id} name={open.name} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function DraftCard({
  item,
  onOpen,
  onRemove,
}: {
  item: DraftAttachment;
  onOpen: (target: { id: string; name: string }) => void;
  onRemove: () => void;
}) {
  return (
    <li className={styles.draft} data-state={item.state}>
      <div className={styles.card}>
        {item.state === 'uploading' ? (
          <span className="spin" aria-hidden="true" />
        ) : (
          <Icon name={item.state === 'failed' ? 'alert' : 'file'} size="sm" />
        )}
        {item.state === 'ready' ? (
          <button
            type="button"
            className={styles.open}
            aria-label={C.open(item.name)}
            onClick={() => onOpen({ id: item.attachment.id, name: item.name })}
          >
            <FileName name={item.name} />
          </button>
        ) : (
          <FileName name={item.name} />
        )}
        <span className={styles.meta}>
          {item.state === 'uploading' ? C.uploading : item.state === 'ready' ? C.size(item.attachment.sizeBytes) : ''}
        </span>
        <IconButton icon="x" label={C.remove(item.name)} className={styles.remove} onClick={onRemove} />
      </div>
      {item.state === 'failed' && <ErrorState error={item.error} />}
    </li>
  );
}
