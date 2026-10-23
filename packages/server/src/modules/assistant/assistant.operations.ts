import {
  abortAssistantOp,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  deleteConversationOp,
  getConversationOp,
  listAssistantFilesOp,
  listConfirmationsOp,
  listConversationsOp,
  replyAssistantPermissionOp,
  sendAssistantMessageOp,
  stopWhisperOp,
  whisperOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { Confirmations } from './assistant.confirmations.ts';
import type { AssistantService } from './assistant.service.ts';
import type { WhisperService } from './assistant.whisper.ts';

export function assistantOperations(
  conversations: AssistantService,
  confirmations: Confirmations,
  whisper: WhisperService,
) {
  return [
    implement(whisperOp, () => whisper.generate()),
    implement(stopWhisperOp, () => whisper.stop()),
    implement(listConversationsOp, () => ({ items: conversations.list() })),
    implement(createConversationOp, ({ title }) => conversations.create(title)),
    implement(getConversationOp, ({ id }) => conversations.get(id)),
    implement(deleteConversationOp, ({ id }) => conversations.delete(id)),
    implement(sendAssistantMessageOp, (input) => conversations.send(input)),
    implement(abortAssistantOp, ({ id }) => conversations.abort(id)),
    implement(replyAssistantPermissionOp, ({ id, permissionId, reply }) =>
      conversations.replyPermission(id, permissionId, reply),
    ),
    implement(listAssistantFilesOp, ({ id }) => ({ items: conversations.files(id) })),
    implement(listConfirmationsOp, ({ id }) => {
      conversations.get(id);
      return { items: confirmations.list(id) };
    }),
    implement(confirmAssistantCallOp, ({ id, alwaysAllow }) => confirmations.confirm(id, alwaysAllow === true)),
    implement(cancelAssistantCallOp, ({ id }) => confirmations.cancel(id)),
  ];
}
