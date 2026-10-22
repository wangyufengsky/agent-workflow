import { z } from 'zod';
import { AssistantForm } from '../../enums/assistant.ts';
import { runtimeStatusSchema } from '../../enums/system.ts';
import { uiModeSchema } from '../../enums/ui.ts';
import { createDbConnectionOp, updateDbConnectionOp } from '../../operations/databases.ts';
import { assistantInputSchema, type OperationContract } from '../../operations/define.ts';
import { createProjectOp, setProjectHostingOp } from '../../operations/projects.ts';
import { createTaskOp } from '../../operations/tasks.ts';
import { assistantPageRefSchema } from '../api/assistant.ts';

/** `get_current_time` (15 §3): the user's local time, so the model can answer「明天几号」without guessing. */
export const getCurrentTimeInputSchema = z.object({});
export const getCurrentTimeOutputSchema = z.object({
  /** ISO 8601 with the local offset, e.g. `2026-10-21T14:03:00+08:00`. */
  now: z.string(),
  /** Local calendar date `YYYY-MM-DD`. */
  date: z.string(),
  /** English weekday name. */
  weekday: z.string(),
  /** IANA time zone, e.g. `Asia/Shanghai`. */
  timeZone: z.string(),
  /** `+08:00` */
  utcOffset: z.string(),
});
export type GetCurrentTimeOutput = z.infer<typeof getCurrentTimeOutputSchema>;

/** `get_app_status` (15 §3). */
export const getAppStatusInputSchema = z.object({});
export const getAppStatusOutputSchema = z.object({
  runtime: runtimeStatusSchema,
  uiMode: uiModeSchema,
  projects: z.number(),
  /** Tasks not in a final state. */
  activeTasks: z.number(),
  /** Open「需要你处理」items that hold something up; results waiting to be merged are not counted (D119). */
  blockingInbox: z.number(),
});
export type GetAppStatusOutput = z.infer<typeof getAppStatusOutputSchema>;

export const openPageInputSchema = assistantPageRefSchema;
export const openedOutputSchema = z.object({ opened: z.literal(true) });

/** The operation each form submits; its credential fields are typed by the user, never prefilled (D28). */
export const ASSISTANT_FORM_OPERATION = {
  [AssistantForm.StartTask]: createTaskOp,
  [AssistantForm.AddProject]: createProjectOp,
  [AssistantForm.ProjectHosting]: setProjectHostingOp,
  [AssistantForm.AddDbConnection]: createDbConnectionOp,
  [AssistantForm.EditDbConnection]: updateDbConnectionOp,
} as const satisfies Record<AssistantForm, OperationContract>;

const formInput = <F extends AssistantForm>(form: F) =>
  z.object({ form: z.literal(form), values: assistantInputSchema(ASSISTANT_FORM_OPERATION[form]).partial() });

/** `open_form`: any non-secret field may be prefilled; a credential field is rejected as unknown. */
export const openFormInputSchema = z.discriminatedUnion('form', [
  formInput(AssistantForm.StartTask),
  formInput(AssistantForm.AddProject),
  formInput(AssistantForm.ProjectHosting),
  formInput(AssistantForm.AddDbConnection),
  formInput(AssistantForm.EditDbConnection),
]);
export type OpenFormInput = { form: AssistantForm; values: Record<string, unknown> };

/** `list_files`: what the assistant wrote in this conversation's files directory. */
export const listFilesInputSchema = z.object({});
export const listFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number(), modifiedAt: z.number() })),
});

/** `reveal_file`: `path` relative to the conversation's files directory. */
export const revealFileInputSchema = z.object({ path: z.string().min(1) });
export const revealedOutputSchema = z.object({ revealed: z.literal(true) });

/**
 * What a write or critical operation tool returns while its call waits for the user (15 §4); the panel shows the
 * confirmation card in place of the call.
 */
export const needsConfirmationOutputSchema = z.object({
  status: z.literal('needs_confirmation'),
  confirmation_id: z.string(),
  instruction: z.string(),
});
export type NeedsConfirmationOutput = z.infer<typeof needsConfirmationOutputSchema>;
