import { z } from 'zod';
import {
  assistantConfirmationSchema,
  assistantConversationSchema,
  assistantFileSchema,
  confirmAssistantCallRequestSchema,
  createConversationRequestSchema,
  replyAssistantPermissionRequestSchema,
  sendAssistantMessageRequestSchema,
} from '../contracts/api/assistant.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
// The panel's own operations: never assistant tools (the assistant must not confirm its own calls) nor palette items.
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

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
