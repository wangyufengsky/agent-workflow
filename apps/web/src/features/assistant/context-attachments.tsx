import {
  ASSISTANT_CONTEXT_MAX_CHARS,
  AssistantPage,
  type AssistantPageRef,
  type AttachmentDTO,
  type SnapshotAssistantContextRequest,
  snapshotAssistantContextOp,
} from '@aw/shared';
import { useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { AttachmentPreview } from '../attachments/attachment-preview.tsx';
import type { AttachmentDraft } from '../attachments/use-attachment-draft.ts';
import type { AddMenuItem } from './add-menu.tsx';
import { useAssistantPage } from './assistant-page.ts';

const C = ASSISTANT_COPY.context;

/**
 * 助手的上下文菜单项（15 §6、36 §4）：选中文字与任务／步骤详情。选区只在用户按下「+」时由 `capture` 读取一次（按下菜单项时
 * 页面选区可能已经没了）；从不扫描页面、表单、剪贴板或其他窗口。`elements` 是两个弹窗，由调用方渲染。
 */
export function useContextAttachments(draft: AttachmentDraft) {
  const page = useAssistantPage();
  const captured = useRef<{ text: string; page: AssistantPageRef }>({ text: '', page });
  const [selection, setSelection] = useState<{ text: string; page: AssistantPageRef }>();
  const [preview, setPreview] = useState<AttachmentDTO>();
  const taskId = page.params.taskId;
  const nodeId = page.params.nodeId;
  const canAttachTask =
    (page.page === AssistantPage.Task || page.page === AssistantPage.TaskPreview || page.page === AssistantPage.Node) &&
    taskId !== undefined;

  function add(source: SnapshotAssistantContextRequest['source'], name: string) {
    draft.addSnapshot(name, () => callOperation(snapshotAssistantContextOp, { source }), setPreview);
  }

  const items: AddMenuItem[] = [
    { label: C.addSelection, icon: 'quote', onSelect: () => setSelection(captured.current) },
  ];
  if (canAttachTask) {
    items.push({
      label: nodeId === undefined ? C.addTask : C.addNode,
      icon: 'list',
      onSelect: () =>
        add(
          { kind: 'task', taskId, ...(nodeId === undefined ? {} : { nodeId }) },
          nodeId === undefined ? C.taskName : C.nodeName,
        ),
    });
  }

  return {
    capture: () => {
      captured.current = { text: window.getSelection()?.toString() ?? '', page };
    },
    items,
    elements: (
      <>
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
      </>
    ),
  };
}
