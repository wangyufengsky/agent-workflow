import { z } from 'zod';
import { COMPANION_WHISPER_MAX_CHARS } from '../constants/app.ts';
import {
  assistantConfirmationSchema,
  assistantConversationSchema,
  assistantFileSchema,
  confirmAssistantCallRequestSchema,
  createConversationRequestSchema,
  externalMcpServerSchema,
  replyAssistantPermissionRequestSchema,
  sendAssistantMessageRequestSchema,
  snapshotAssistantContextRequestSchema,
} from '../contracts/api/assistant.ts';
import { attachmentIdsSchema, attachmentSchema, officeFilePreviewSchema } from '../contracts/api/attachments.ts';
import { transcriptPageSchema, transcriptQuerySchema } from '../contracts/api/attempts.ts';
import {
  assistantBrowserConfirmationSchema,
  assistantBrowserControlSchema,
  assistantBrowserResultSchema,
} from '../contracts/api/browser.ts';
import { OperationRisk, permissionModeSchema } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
// The panel's own operations: never assistant tools (the assistant must not confirm its own calls) nor palette items.
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

export const snapshotAssistantContextOp = defineOperationContract({
  ...common,
  id: 'assistant.snapshotContext',
  title: 'op.assistant.snapshotContext',
  description: 'Save explicitly selected text or current task details as an immutable text attachment',
  input: snapshotAssistantContextRequestSchema,
  output: attachmentSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/context-snapshots', status: 201 },
});

export const listConversationsOp = defineOperationContract({
  ...common,
  id: 'assistant.list',
  title: 'op.assistant.list',
  description: 'Assistant conversations, most recently updated first',
  input: z.object({}),
  output: z.object({ items: z.array(assistantConversationSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations' },
});

export const setConversationPermissionModeOp = defineOperationContract({
  ...common,
  id: 'assistant.setPermissionMode',
  title: 'op.assistant.setPermissionMode',
  description: 'Set the approval policy for this conversation',
  input: z.object({ id: z.string(), permissionMode: permissionModeSchema }),
  output: assistantConversationSchema,
  http: { method: 'PATCH', path: '/assistant/conversations/:id/permission-mode' },
  risk: OperationRisk.Critical,
  expose: { palette: false, assistant: false },
});

export const createConversationOp = defineOperationContract({
  ...common,
  id: 'assistant.create',
  title: 'op.assistant.create',
  description: 'Start a new assistant conversation',
  input: createConversationRequestSchema,
  output: assistantConversationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/conversations', status: 201 },
});

export const createAssistantContinuationOp = defineOperationContract({
  ...common,
  id: 'assistant.continue',
  title: 'op.assistant.continue',
  description: 'Continue a conversation with a bounded historical handoff',
  input: byId.extend({ requestId: z.string().uuid(), attachmentIds: attachmentIdsSchema }),
  output: assistantConversationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/conversations/:id/continuations', status: 201 },
});

export const getAssistantContinuationHistoryOp = defineOperationContract({
  ...common,
  id: 'assistant.continuationHistory',
  title: 'op.assistant.continuationHistory',
  description: 'Read the source transcript up to the continuation cutoff',
  input: byId.extend(transcriptQuerySchema.shape),
  output: transcriptPageSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/continuation/history' },
});

export const listAssistantAttachmentsOp = defineOperationContract({
  ...common,
  id: 'assistant.attachments',
  title: 'op.assistant.attachments',
  description: 'List attachments owned by a conversation',
  input: byId,
  output: z.object({ items: z.array(attachmentSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/attachments' },
});

export const getConversationOp = defineOperationContract({
  ...common,
  id: 'assistant.get',
  title: 'op.assistant.get',
  description: 'An assistant conversation',
  input: byId,
  output: assistantConversationSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id' },
});

export const deleteConversationOp = defineOperationContract({
  ...common,
  id: 'assistant.delete',
  title: 'op.assistant.delete',
  description: 'Delete a conversation with its messages, confirmations and generated files',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/assistant/conversations/:id' },
});

export const sendAssistantMessageOp = defineOperationContract({
  ...common,
  id: 'assistant.send',
  title: 'op.assistant.send',
  description: 'Send a message to the assistant together with the page the user is on',
  input: sendAssistantMessageRequestSchema,
  output: assistantConversationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/conversations/:id/messages' },
});

/** 仅界面可更新当前预览关联，模型不能自行指定或激活标签页。 */
export const bindAssistantPreviewOp = defineOperationContract({
  ...common,
  id: 'assistant.bindPreview',
  title: 'op.assistant.bindPreview',
  description: 'Bind or clear the user-selected preview for this conversation',
  input: byId.extend({ preview: z.object({ taskId: z.string(), tabId: z.string() }).nullable() }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/assistant/conversations/:id/preview' },
});

export const controlAssistantBrowserOp = defineOperationContract({
  ...common,
  id: 'assistant.controlBrowser',
  title: 'op.assistant.controlBrowser',
  description: 'Allow or stop browser control for a specific preview tab and conversation',
  input: byId.extend({ tabId: z.string(), enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/assistant/conversations/:id/browser-control' },
});

export const getAssistantBrowserControlOp = defineOperationContract({
  ...common,
  id: 'assistant.getBrowserControl',
  title: 'op.assistant.getBrowserControl',
  description: 'Read preview ownership and the conversation’s browser activity',
  input: byId.extend({ tabId: z.string() }),
  output: assistantBrowserControlSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/browser-control' },
});

export const handoffAssistantBrowserOp = defineOperationContract({
  ...common,
  id: 'assistant.handoffBrowser',
  title: 'op.assistant.handoffBrowser',
  description: 'Take over the granted preview or return it to the assistant',
  input: byId.extend({ tabId: z.string(), manual: z.boolean() }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/assistant/conversations/:id/browser-control/handoff', status: 204 },
});

export const actAssistantBrowserOp = defineOperationContract({
  ...common,
  id: 'assistant.actBrowser',
  title: 'op.assistant.actBrowser',
  description: 'Perform a single confirmed action on the selected preview',
  input: assistantBrowserConfirmationSchema,
  output: assistantBrowserResultSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/assistant/browser-actions' },
});

export const abortAssistantOp = defineOperationContract({
  ...common,
  id: 'assistant.abort',
  title: 'op.assistant.abort',
  description: 'Stop the assistant working on its current turn',
  input: byId,
  output: assistantConversationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/conversations/:id/abort' },
});

export const replyAssistantPermissionOp = defineOperationContract({
  ...common,
  id: 'assistant.replyPermission',
  title: 'op.assistant.replyPermission',
  description: 'Answer a permission request of the assistant session',
  input: replyAssistantPermissionRequestSchema,
  output: assistantConversationSchema,
  // `always` widens what the assistant may do, like a permission in「需要你处理」(D59).
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/assistant/conversations/:id/permissions/:permissionId' },
});

export const listAssistantFilesOp = defineOperationContract({
  ...common,
  id: 'assistant.files',
  title: 'op.assistant.files',
  description: 'Files the assistant wrote in this conversation',
  input: byId,
  output: z.object({ items: z.array(assistantFileSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/files' },
});

export const previewAssistantFileOp = defineOperationContract({
  ...common,
  id: 'assistant.previewFile',
  title: 'op.assistant.previewFile',
  description: "A Word or Excel file the assistant wrote, read for its card's preview",
  input: z.object({ id: z.string(), path: z.string().min(1), sheet: z.string().min(1).optional() }),
  output: officeFilePreviewSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/files/preview' },
});

export const listExternalMcpOp = defineOperationContract({
  ...common,
  id: 'assistant.externalMcp',
  title: 'op.assistant.externalMcp',
  description: "MCP servers of the user's own opencode configuration the assistant can use, and their status",
  input: z.object({}),
  output: z.object({ items: z.array(externalMcpServerSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/external-mcp' },
});

export const listConfirmationsOp = defineOperationContract({
  ...common,
  id: 'assistant.confirmations',
  title: 'op.assistant.confirmations',
  description: 'Calls of this conversation that needed the user, oldest first',
  input: byId,
  output: z.object({ items: z.array(assistantConfirmationSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/conversations/:id/confirmations' },
});

export const confirmAssistantCallOp = defineOperationContract({
  ...common,
  id: 'assistant.confirm',
  title: 'op.assistant.confirm',
  description: 'Run a call the assistant asked for and send it the result',
  input: confirmAssistantCallRequestSchema,
  output: assistantConfirmationSchema,
  // Runs whatever the assistant asked for, critical operations included.
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/assistant/confirmations/:id/confirm' },
});

export const cancelAssistantCallOp = defineOperationContract({
  ...common,
  id: 'assistant.cancelConfirmation',
  title: 'op.assistant.cancelConfirmation',
  description: 'Decline a call the assistant asked for',
  input: byId,
  output: assistantConfirmationSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/confirmations/:id/cancel' },
});

export const whisperOp = defineOperationContract({
  ...common,
  id: 'assistant.whisper',
  title: 'op.assistant.whisper',
  description: 'Generate one companion remark in an isolated session without tools',
  input: z.object({}),
  output: z.object({ text: z.string().min(1).max(COMPANION_WHISPER_MAX_CHARS) }),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/whisper' },
});
export const stopWhisperOp = defineOperationContract({
  ...common,
  id: 'assistant.stopWhisper',
  title: 'op.assistant.stopWhisper',
  description: 'Cancel the companion remark in progress',
  input: z.object({}),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/assistant/whisper/stop', status: 204 },
});
