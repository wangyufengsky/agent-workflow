import { z } from 'zod';

/** Where an attachment's content came from (30 §2). */
export const AttachmentSource = {
  /** A file the user picked or dropped. */
  Upload: 'upload',
  /** A snapshot of a file in a project or task worktree (30 §2.1). */
  ProjectFile: 'project_file',
} as const;
export type AttachmentSource = (typeof AttachmentSource)[keyof typeof AttachmentSource];
export const attachmentSourceSchema = z.enum(AttachmentSource);

/** What an attachment reference belongs to (10 §6.1); the owner id is that object's id. */
export const AttachmentOwnerKind = {
  /** The task's starting input; the owner is the task. */
  TaskInput: 'task_input',
  /** Feedback of「再改改」; the owner is the revise node it added. */
  TaskFeedback: 'task_feedback',
  /** A user message of an assistant conversation; the owner is the conversation. */
  AssistantMessage: 'assistant_message',
} as const;
export type AttachmentOwnerKind = (typeof AttachmentOwnerKind)[keyof typeof AttachmentOwnerKind];
export const attachmentOwnerKindSchema = z.enum(AttachmentOwnerKind);
