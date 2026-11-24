import {
  AppError,
  abortAssistantOp,
  actAssistantBrowserOp,
  bindAssistantPreviewOp,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  controlAssistantBrowserOp,
  createAssistantContinuationOp,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  getAssistantBrowserControlOp,
  getAssistantContinuationHistoryOp,
  getConversationOp,
  handoffAssistantBrowserOp,
  listAssistantAttachmentsOp,
  listAssistantFilesOp,
  listConfirmationsOp,
  listConversationsOp,
  listExternalMcpOp,
  previewAssistantFileOp,
  replyAssistantPermissionOp,
  sendAssistantMessageOp,
  setConversationPermissionModeOp,
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

export const confirmedBrowserOperation = implement(actAssistantBrowserOp, () => {
  throw new AppError(ErrorCode.ValidationFailed, 'Use the conversation confirmation');
});

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
    implement(setConversationPermissionModeOp, ({ id, permissionMode }) =>
      conversations.setPermissionMode(id, permissionMode),
    ),
    implement(createConversationOp, ({ title, projectId, permissionMode }) =>
      conversations.create(title, projectId, permissionMode),
    ),
    implement(createAssistantContinuationOp, (input) => conversations.continueConversation(input)),
    implement(getAssistantContinuationHistoryOp, ({ id, afterSeq }) => conversations.continuationHistory(id, afterSeq)),
    implement(listAssistantAttachmentsOp, ({ id }) => ({ items: conversations.listAttachments(id) })),
    implement(getConversationOp, ({ id }) => conversations.get(id)),
    implement(deleteConversationOp, async ({ id }) => {
      browser.bindPreview(id, null);
      await conversations.delete(id);
    }),
    implement(bindAssistantPreviewOp, ({ id, preview }) => {
      // 取消关联是幂等清理；删除对话后的界面卸载仍会发送它。
      if (preview !== null) conversations.get(id);
      browser.bindPreview(id, preview);
    }),
    implement(controlAssistantBrowserOp, ({ id, tabId, enabled }) => {
      const conversation = conversations.get(id);
      return browser.setAssistantControl(id, conversation.projectId, tabId, enabled);
    }),
    implement(getAssistantBrowserControlOp, ({ id, tabId }) => {
      conversations.get(id);
      return browser.assistantControlInfo(id, tabId);
    }),
    implement(handoffAssistantBrowserOp, ({ id, tabId, manual }) => {
      conversations.get(id);
      return browser.handoffAssistantControl(id, tabId, manual);
    }),
    confirmedBrowserOperation,
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
