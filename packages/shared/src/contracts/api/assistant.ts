import { z } from 'zod';
import { ASSISTANT_CONTEXT_MAX_CHARS, ASSISTANT_MESSAGE_MAX_CHARS } from '../../constants/limits.ts';
import {
  ASSISTANT_PAGE_PARAMS,
  assistantConfirmationStatusSchema,
  assistantPageSchema,
} from '../../enums/assistant.ts';
import { permissionDecisionSchema } from '../../enums/inbox.ts';
import { operationRiskSchema } from '../../enums/system.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { attachmentIdsSchema } from './attachments.ts';

/** A permission request of the assistant's session, answered in the panel (15 §6). Kept in memory, like opencode's. */
export const assistantPermissionRequestSchema = z.object({
  permissionId: z.string(),
  permission: z.string(),
  patterns: z.array(z.string()),
});
export type AssistantPermissionRequestDTO = z.infer<typeof assistantPermissionRequestSchema>;

/** `AssistantConversationDTO` (11 §13): `busy` while the assistant works on a turn. */
export const assistantConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  busy: z.boolean(),
  pendingPermissions: z.array(assistantPermissionRequestSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AssistantConversationDTO = z.infer<typeof assistantConversationSchema>;

/**
 * A page and the ids it is about: where the user is (sent with each message) and what `open_page` opens. Each page
 * needs its `ASSISTANT_PAGE_PARAMS`; on the task page `nodeId` is the selected step.
 */
export const assistantPageRefSchema = z
  .object({
    page: assistantPageSchema,
    params: z
      .strictObject({
        taskId: z.string().min(1).optional(),
        nodeId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        workflowKey: z.string().min(1).optional(),
        knowledgeConversationId: z.string().min(1).optional(),
        deckId: z.string().min(1).optional(),
        /** On a PPT's workspace: the selected page. */
        slideId: z.string().min(1).optional(),
        batchId: z.string().min(1).optional(),
        scheduleId: z.string().min(1).optional(),
      })
      .default({}),
  })
  .superRefine(({ page, params }, ctx) => {
    for (const param of ASSISTANT_PAGE_PARAMS[page]) {
      if (params[param] === undefined) {
        ctx.addIssue({ code: 'custom', path: ['params', param], message: `${page} needs ${param}` });
      }
    }
  });
export type AssistantPageRef = z.infer<typeof assistantPageRefSchema>;

/** 用户明确选择的文字；页面仅为来源说明，不表示内容可信或仍然最新。 */
const assistantContextSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('task'),
    taskId: z.string().min(1),
    nodeId: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('selection'),
    text: z.string().trim().min(1).max(ASSISTANT_CONTEXT_MAX_CHARS),
    page: assistantPageRefSchema,
  }),
]);
export const snapshotAssistantContextRequestSchema = z.strictObject({ source: assistantContextSourceSchema });
export type SnapshotAssistantContextRequest = z.infer<typeof snapshotAssistantContextRequestSchema>;

export const createConversationRequestSchema = z.object({ title: z.string().trim().min(1).optional() });

export const sendAssistantMessageRequestSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX_CHARS),
  context: assistantPageRefSchema,
  /** Files attached to the message (30); the rest of the conversation can read them. */
  attachmentIds: attachmentIdsSchema.optional(),
});
export type SendAssistantMessageRequest = z.infer<typeof sendAssistantMessageRequestSchema>;

export const replyAssistantPermissionRequestSchema = z.object({
  id: z.string(),
  permissionId: z.string(),
  reply: permissionDecisionSchema,
});

/** What the backend did with a confirmed call: the operation's output or its error. */
export const assistantConfirmationResultSchema = z.discriminatedUnion('ok', [
  // 旧版 void 结果序列化后没有 output；读出时统一为可持久化的 null。
  z.object({ ok: z.literal(true), output: z.unknown().default(null) }),
  z.object({ ok: z.literal(false), error: errorInfoSchema }),
]);
export type AssistantConfirmationResult = z.infer<typeof assistantConfirmationResultSchema>;

/** `assistant_confirmations` row (10 §4) with the operation's title key and risk for the card. */
export const assistantConfirmationSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  operationId: z.string(),
  /** Copy key of the operation title (web/src/copy). */
  title: z.string(),
  risk: operationRiskSchema,
  /** The parsed input the operation will run with (never holds credentials, D28). */
  input: z.record(z.string(), z.unknown()),
  status: assistantConfirmationStatusSchema,
  result: assistantConfirmationResultSchema.nullable(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
});
export type AssistantConfirmationDTO = z.infer<typeof assistantConfirmationSchema>;

export const confirmAssistantCallRequestSchema = z.object({
  id: z.string(),
  /** Also add the operation to `assistant.alwaysAllow`; write risk only (D27). */
  alwaysAllow: z.boolean().optional(),
});

/** A file the assistant wrote in `files/<conversationId>/`; `path` is relative to that directory. */
export const assistantFileSchema = z.object({
  path: z.string(),
  absolutePath: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
});
export type AssistantFileDTO = z.infer<typeof assistantFileSchema>;
