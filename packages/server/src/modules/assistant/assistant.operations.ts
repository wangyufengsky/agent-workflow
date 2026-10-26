import {
  abortAssistantOp,
  bindAssistantPreviewOp,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  deleteConversationOp,
  getConversationOp,
  listAssistantFilesOp,
  listConfirmationsOp,
  listConversationsOp,
  listExternalMcpOp,
  previewAssistantFileOp,
  replyAssistantPermissionOp,
  sendAssistantMessageOp,
  snapshotAssistantContextOp,
  stopWhisperOp,
  whisperOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BrowserService } from '../browser/index.ts';
import type { Office } from '../office/index.ts';
import type { Confirmations } from './assistant.confirmations.ts';
import type { AssistantService } from './assistant.service.ts';
import type { AssistantSnapshots } from './assistant.snapshots.ts';
import type { WhisperService } from './assistant.whisper.ts';

export function assistantOperations(
  conversations: AssistantService,
  confirmations: Confirmations,
  whisper: WhisperService,
  snapshots: AssistantSnapshots,
  browser: BrowserService,
  office: Office,
) {
  return [
    implement(snapshotAssistantContextOp, (input) => snapshots.create(input)),
    implement(whisperOp, () => whisper.generate()),
    implement(stopWhisperOp, () => whisper.stop()),
    implement(listConversationsOp, () => ({ items: conversations.list() })),
    implement(createConversationOp, ({ title }) => conversations.create(title)),
    implement(getConversationOp, ({ id }) => conversations.get(id)),
    implement(deleteConversationOp, async ({ id }) => {
      await conversations.delete(id);
      browser.bindPreview(id, null);
    }),
    implement(bindAssistantPreviewOp, ({ id, preview }) => {
      // 取消关联是幂等清理；删除对话后的界面卸载仍会发送它。
      if (preview !== null) conversations.get(id);
      browser.bindPreview(id, preview);
    }),
    implement(sendAssistantMessageOp, (input) => conversations.send(input)),
    implement(abortAssistantOp, ({ id }) => conversations.abort(id)),
    implement(replyAssistantPermissionOp, ({ id, permissionId, reply }) =>
      conversations.replyPermission(id, permissionId, reply),
    ),
    implement(listAssistantFilesOp, ({ id }) => ({ items: conversations.files(id) })),
    implement(previewAssistantFileOp, ({ id, path, sheet }) =>
      office.previewFile(conversations.fileOf(id, path), sheet),
    ),
    implement(listExternalMcpOp, async () => ({ items: await conversations.externalMcp() })),
    implement(listConfirmationsOp, ({ id }) => {
      conversations.get(id);
      return { items: confirmations.list(id) };
    }),
    implement(confirmAssistantCallOp, ({ id, alwaysAllow }) => confirmations.confirm(id, alwaysAllow === true)),
    implement(cancelAssistantCallOp, ({ id }) => confirmations.cancel(id)),
  ];
}
