import { AttachmentFormat } from '@aw/shared';
import { type ClipboardEvent, type DragEvent, useRef, useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { AttachmentPreview } from './attachment-preview.tsx';
import { failureMessage } from './attachments.api.ts';
import styles from './attachments.module.css';
import { FileName } from './file-name.tsx';
import { ProjectFileDialog, type ProjectFileSource } from './project-file-dialog.tsx';
import { type AttachmentDraft, type DraftAttachment, looksLikeOffice } from './use-attachment-draft.ts';

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
 * How an input picks attachments (30 §2): a file of the computer and, with a `projectFiles` source, a file of the
 * project. `elements` (the hidden file input and the project file dialog) must be rendered by the caller.
 */
export function useAttachmentPickers(draft: AttachmentDraft, projectFiles: ProjectFileSource | undefined) {
  const picker = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  return {
    pickFile: () => picker.current?.click(),
    pickProjectFile: projectFiles === undefined ? undefined : () => setPicking(true),
    elements: (
      <>
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
        {picking && projectFiles !== undefined && (
          <ProjectFileDialog source={projectFiles} onAdd={draft.addProjectFile} onClose={() => setPicking(false)} />
        )}
      </>
    ),
  };
}

/** What is attached and the draft's notice; nothing at all while there is neither (36 §4). */
export function AttachmentList({ draft }: { draft: AttachmentDraft }) {
  const [open, setOpen] = useState<{ id: string; name: string }>();
  if (draft.items.length === 0 && draft.notice === undefined && open === undefined) return null;
  return (
    <div className={styles.bar}>
      {draft.items.length > 0 && (
        <ul className={styles.list} aria-label={C.listLabel}>
          {draft.items.map((item) => (
            <DraftCard key={item.key} item={item} onOpen={setOpen} onRemove={() => draft.remove(item.key)} />
          ))}
        </ul>
      )}
      {draft.notice !== undefined && (
        <span className="hint" role="status">
          {draft.notice}
        </span>
      )}
      {open !== undefined && <AttachmentPreview id={open.id} name={open.name} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

/** The attachments of a dialog's input (「再改改」): the list and「添加资料」「项目文件」as buttons. */
export function AttachmentBar({
  draft,
  projectFiles,
}: {
  draft: AttachmentDraft;
  projectFiles?: ProjectFileSource | undefined;
}) {
  const pickers = useAttachmentPickers(draft, projectFiles);
  return (
    <div className={styles.bar}>
      <AttachmentList draft={draft} />
      <div className={styles.actions}>
        <button type="button" className={styles.add} onClick={pickers.pickFile}>
          <Icon name="paperclip" size="sm" />
          {C.add}
        </button>
        {pickers.pickProjectFile !== undefined && (
          <button type="button" className={styles.add} onClick={pickers.pickProjectFile}>
            <Icon name="folder" size="sm" />
            {C.addProjectFile}
          </button>
        )}
        {pickers.elements}
      </div>
    </div>
  );
}

function metaOf(item: DraftAttachment): string {
  if (item.state === 'uploading') return looksLikeOffice(item.name) ? C.reading : C.uploading;
  if (item.state === 'failed') return '';
  const { meta, sizeBytes } = item.attachment;
  return meta === null ? C.size(sizeBytes) : C.summary(meta);
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
          <Icon
            name={
              item.state === 'failed' ? 'alert' : item.attachment.format === AttachmentFormat.Xlsx ? 'table' : 'file'
            }
            size="sm"
          />
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
        <span className={styles.meta}>{metaOf(item)}</span>
        <IconButton icon="x" label={C.remove(item.name)} className={styles.remove} onClick={onRemove} />
      </div>
      {item.state === 'failed' && <ErrorState error={item.error} message={failureMessage(item.error)} />}
    </li>
  );
}
