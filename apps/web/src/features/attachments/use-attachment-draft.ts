import {
  ATTACHMENT_BYTES_MAX,
  ATTACHMENTS_PER_INPUT_MAX,
  type AttachmentDTO,
  type SnapshotProjectFileRequest,
} from '@aw/shared';
import { useState } from 'react';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { removeAttachment, snapshotProjectFile, tooLargeError, uploadAttachment } from './attachments.api.ts';

/** One attachment of the input being written: uploading, ready to send, or failed with the backend's error. */
export type DraftAttachment =
  | { key: string; name: string; state: 'uploading' }
  | { key: string; name: string; state: 'ready'; attachment: AttachmentDTO }
  | { key: string; name: string; state: 'failed'; error: unknown };

/**
 * The attachments of one input (30 §2): uploaded as soon as they are picked, sent with the text, then cleared. Like
 * the text they live in the component only; one never sent is removed by the backend's cleanup (30 §4).
 */
export function useAttachmentDraft() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string>();

  const settle = (key: string, next: DraftAttachment) =>
    setItems((list) => list.map((item) => (item.key === key ? next : item)));

  function track(name: string, work: () => Promise<AttachmentDTO>): void {
    const key = crypto.randomUUID();
    setItems((list) => [...list, { key, name, state: 'uploading' }]);
    work().then(
      (attachment) => settle(key, { key, name: attachment.name, state: 'ready', attachment }),
      (error: unknown) => settle(key, { key, name, state: 'failed', error }),
    );
  }

  /** Files picked, dropped or pasted. Images are not accepted yet (30 §1): said once, not uploaded. */
  function addFiles(files: readonly File[]): void {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    const room = ATTACHMENTS_PER_INPUT_MAX - items.length;
    setNotice(images.length > 0 ? C.imageUnsupported : others.length > room ? C.tooMany : undefined);
    for (const file of others.slice(0, Math.max(room, 0))) {
      if (file.size > ATTACHMENT_BYTES_MAX) {
        setItems((list) => [
          ...list,
          { key: crypto.randomUUID(), name: file.name, state: 'failed', error: tooLargeError(ATTACHMENT_BYTES_MAX) },
        ]);
      } else {
        track(file.name, () => uploadAttachment(file));
      }
    }
  }

  function addProjectFile(input: SnapshotProjectFileRequest): void {
    if (items.length >= ATTACHMENTS_PER_INPUT_MAX) {
      setNotice(C.tooMany);
      return;
    }
    setNotice(undefined);
    track(input.path.split('/').at(-1) ?? input.path, () => snapshotProjectFile(input));
  }

  const ready = items.flatMap((item) => (item.state === 'ready' ? [item.attachment.id] : []));
  return {
    items,
    notice,
    addFiles,
    addProjectFile,
    /** An uploaded one is deleted on the server too, so adding and removing files does not pile them up there. */
    remove(key: string): void {
      const item = items.find((i) => i.key === key);
      setItems((list) => list.filter((i) => i.key !== key));
      if (item?.state !== 'ready') return;
      removeAttachment(item.attachment.id).catch(() => setNotice(C.removeFailed));
    },
    clear: () => {
      setItems([]);
      setNotice(undefined);
    },
    /** Ids to send, in order. */
    ids: ready,
    /** Something is still uploading or failed: the input waits until it is removed (30 §2). */
    blocked: ready.length !== items.length,
  };
}
export type AttachmentDraft = ReturnType<typeof useAttachmentDraft>;
