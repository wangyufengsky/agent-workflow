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

/** What an attachment's original is (39 §4), told by its content; the model always reads text. */
export const AttachmentFormat = {
  /** UTF-8 text (30 §3.1), or GB18030 text named `.csv` / `.tsv` / `.txt` stored as UTF-8. */
  Text: 'text',
  /** Word (`.docx`, `.docm`): the model reads its body as Markdown. */
  Docx: 'docx',
  /** Excel (`.xlsx`, `.xlsm`): the model reads its sheets as tables. */
  Xlsx: 'xlsx',
} as const;
export type AttachmentFormat = (typeof AttachmentFormat)[keyof typeof AttachmentFormat];
export const attachmentFormatSchema = z.enum(AttachmentFormat);

/** Why an upload is not an attachment (`ATTACHMENT_INVALID_TYPE` `details.reason`, 08). */
export const AttachmentRejection = {
  /** Neither UTF-8 text (nor GB18030 text with a text file name) nor a Word or Excel file. */
  NotText: 'not_text',
  /** Word 97–2003 `.doc` or Excel 97–2003 `.xls`: to be saved as `.docx` / `.xlsx` first (D194). */
  LegacyOffice: 'legacy_office',
  /** A Word or Excel file with an opening password. */
  Encrypted: 'encrypted',
  /** Another zip-based format (`.pptx`, `.odt`, an archive). */
  Unsupported: 'unsupported',
} as const;
export type AttachmentRejection = (typeof AttachmentRejection)[keyof typeof AttachmentRejection];

/** What an upload is over (`ATTACHMENT_TOO_LARGE` `details.reason`, 08); `details.limit` is that limit. */
export const AttachmentLimit = {
  Bytes: 'bytes',
  /** Attachments in one input. */
  Count: 'count',
  /** A Word or Excel file's parts, unzipped. */
  Unzipped: 'unzipped',
  /** An Excel file's non-empty cells. */
  Cells: 'cells',
} as const;
export type AttachmentLimit = (typeof AttachmentLimit)[keyof typeof AttachmentLimit];

/** Why a Word or Excel file could not be read (`ATTACHMENT_PARSE_FAILED` `details.reason`, 08). */
export const AttachmentParseFailure = {
  Corrupt: 'corrupt',
  Timeout: 'timeout',
  OutOfMemory: 'out_of_memory',
} as const;
export type AttachmentParseFailure = (typeof AttachmentParseFailure)[keyof typeof AttachmentParseFailure];

/** What an attachment reference belongs to (10 §6.1); the owner id is that object's id. */
export const AttachmentOwnerKind = {
  /** The task's starting input; the owner is the task. */
  TaskInput: 'task_input',
  /** Feedback of「再改改」; the owner is the revise node it added. */
  TaskFeedback: 'task_feedback',
  /** A user message of an assistant conversation; the owner is the conversation. */
  AssistantMessage: 'assistant_message',
  /** The source material of an initiative; each work package's task references it again (34 §7). */
  Initiative: 'initiative',
} as const;
export type AttachmentOwnerKind = (typeof AttachmentOwnerKind)[keyof typeof AttachmentOwnerKind];
export const attachmentOwnerKindSchema = z.enum(AttachmentOwnerKind);
