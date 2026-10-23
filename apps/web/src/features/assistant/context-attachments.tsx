import {
  ASSISTANT_CONTEXT_MAX_CHARS,
  AssistantPage,
  type AssistantPageRef,
  type AttachmentDTO,
  type SnapshotAssistantContextRequest,
  snapshotAssistantContextOp,
} from '@aw/shared';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { AttachmentPreview } from '../attachments/attachment-preview.tsx';
import attachmentStyles from '../attachments/attachments.module.css';
import type { AttachmentDraft } from '../attachments/use-attachment-draft.ts';
import { useAssistantPage } from './assistant-page.ts';

const C = ASSISTANT_COPY.context;

/** 仅在用户点击时读取选区；从不扫描页面、表单、剪贴板或其他窗口。 */
export function ContextAttachments({ draft }: { draft: AttachmentDraft }) {
  const page = useAssistantPage();
  const [selection, setSelection] = useState<{ text: string; page: AssistantPageRef }>();
  const [preview, setPreview] = useState<AttachmentDTO>();
  const taskId = page.params.taskId;
  const nodeId = page.params.nodeId;
  const canAttachTask = (page.page === AssistantPage.Task || page.page === AssistantPage.Node) && taskId !== undefined;

  function add(source: SnapshotAssistantContextRequest['source'], name: string) {
    draft.addSnapshot(name, () => callOperation(snapshotAssistantContextOp, { source }), setPreview);
  }

  return (
    <div className={attachmentStyles.actions}>
      <button
        type="button"
        className={attachmentStyles.add}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setSelection({ text: window.getSelection()?.toString() ?? '', page })}
      >
        {C.addSelection}
      </button>
      {canAttachTask && (
        <button
          type="button"
          className={attachmentStyles.add}
          onClick={() =>
            add(
              { kind: 'task', taskId, ...(nodeId === undefined ? {} : { nodeId }) },
              nodeId === undefined ? C.taskName : C.nodeName,
            )
          }
        >
          {nodeId === undefined ? C.addTask : C.addNode}
        </button>
      )}
      {selection !== undefined && (
        <Dialog
          open
          onOpenChange={(open) => !open && setSelection(undefined)}
          title={C.title}
          description={C.hint}
          footer={
            <>
              <Button onClick={() => setSelection(undefined)}>{C.cancel}</Button>
              <Button
                variant="primary"
                disabled={selection.text.trim() === '' || selection.text.length > ASSISTANT_CONTEXT_MAX_CHARS}
                onClick={() => {
                  add({ kind: 'selection', text: selection.text, page: selection.page }, C.selectionName);
                  setSelection(undefined);
                }}
              >
                {C.add}
              </Button>
            </>
          }
        >
          <p className="hint">{C.source}</p>
          <label className="field">
            <span>{C.text}</span>
            <textarea
              rows={8}
              value={selection.text}
              onChange={(e) => setSelection({ ...selection, text: e.target.value })}
            />
          </label>
          {selection.text.length > ASSISTANT_CONTEXT_MAX_CHARS && (
            <p role="alert">{C.tooLong(ASSISTANT_CONTEXT_MAX_CHARS)}</p>
          )}
        </Dialog>
      )}
      {preview !== undefined && (
        <AttachmentPreview id={preview.id} name={preview.name} onClose={() => setPreview(undefined)} />
      )}
    </div>
  );
}
