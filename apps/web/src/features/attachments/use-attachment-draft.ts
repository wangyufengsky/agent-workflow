import {
  ATTACHMENT_BYTES_MAX,
  ATTACHMENTS_PER_INPUT_MAX,
  type AttachmentDTO,
  OFFICE_ATTACHMENT_BYTES_MAX,
  type SnapshotProjectFileRequest,
} from '@aw/shared';
import { useRef, useState } from 'react';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { removeAttachment, snapshotProjectFile, tooLargeError, uploadAttachment } from './attachments.api.ts';

/**
 * Names the backend may read as Word or Excel (39 §4). Only for the size checked before uploading and the
 * card's「正在读取…」: the backend decides by content.
 */
export const looksLikeOffice = (name: string) => /\.(docx|docm|xlsx|xlsm)$/i.test(name);

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
  const pending = useRef(new Set<string>());

  const settle = (key: string, next: DraftAttachment) =>
    setItems((list) => list.map((item) => (item.key === key ? next : item)));

  function track(
    name: string,
    work: () => Promise<AttachmentDTO>,
    onReady?: (attachment: AttachmentDTO) => void,
  ): void {
    const key = crypto.randomUUID();
    pending.current.add(key);
    setItems((list) => [...list, { key, name, state: 'uploading' }]);
    work().then(
      (attachment) => {
        // 移除正在生成的快照后，迟到的响应不能重开预览；未引用的原件由附件清理回收。
        if (!pending.current.delete(key)) return;
        settle(key, { key, name: attachment.name, state: 'ready', attachment });
        onReady?.(attachment);
      },
      (error: unknown) => {
        if (pending.current.delete(key)) settle(key, { key, name, state: 'failed', error });
      },
    );
  }

  /** Files picked, dropped or pasted. Images are not accepted yet (30 §1): said once, not uploaded. */
  function addFiles(files: readonly File[]): void {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    const room = ATTACHMENTS_PER_INPUT_MAX - items.length;
    setNotice(images.length > 0 ? C.imageUnsupported : others.length > room ? C.tooMany : undefined);
    for (const file of others.slice(0, Math.max(room, 0))) {
      const limit = looksLikeOffice(file.name) ? OFFICE_ATTACHMENT_BYTES_MAX : ATTACHMENT_BYTES_MAX;
      if (file.size > limit) {
        setItems((list) => [
          ...list,
          { key: crypto.randomUUID(), name: file.name, state: 'failed', error: tooLargeError(limit) },
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
    /** 应用生成的文字快照复用上传中、失败、预览和清理行为；不会绕过每条消息的数量上限。 */
    addSnapshot(name: string, work: () => Promise<AttachmentDTO>, onReady: (attachment: AttachmentDTO) => void): void {
      if (items.length >= ATTACHMENTS_PER_INPUT_MAX) {
        setNotice(C.tooMany);
        return;
      }
      setNotice(undefined);
      track(name, work, onReady);
    },
    /** An uploaded one is deleted on the server too, so adding and removing files does not pile them up there. */
    remove(key: string): void {
      pending.current.delete(key);
      const item = items.find((i) => i.key === key);
      setItems((list) => list.filter((i) => i.key !== key));
      if (item?.state !== 'ready') return;
      removeAttachment(item.attachment.id).catch(() => setNotice(C.removeFailed));
    },
    clear: () => {
      pending.current.clear();
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
