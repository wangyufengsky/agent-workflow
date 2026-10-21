import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  AppError,
  ASSISTANT_FORM_OPERATION,
  AssistantForm,
  AssistantToolName,
  assistantFormSchema,
  assistantInputSchema,
  ErrorCode,
  type GetAppStatusOutput,
  getAppStatusInputSchema,
  getCurrentTimeInputSchema,
  listFilesInputSchema,
  openFormInputSchema,
  openPageInputSchema,
  revealFileInputSchema,
  ServerEventType,
  UiMode,
} from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';
import { localTime } from './assistant.context.ts';
import type { AssistantService } from './assistant.service.ts';
import type { AssistantTool } from './assistant.tools.ts';

export type HelperToolDeps = {
  clock: Clock;
  timeZone: string;
  events: EventBus;
  conversations: AssistantService;
  appStatus(): Promise<GetAppStatusOutput>;
};

/** The fields `open_form` may prefill, per form, for the model to read in the description. */
const FORM_FIELDS = Object.values(AssistantForm)
  .map((form) => `${form}: ${Object.keys(assistantInputSchema(ASSISTANT_FORM_OPERATION[form]).shape).join(', ')}`)
  .join('; ');

/**
 * `open_form` as the model sees it: MCP needs an object schema at the top, so the per-form values are checked
 * against `openFormInputSchema` in the handler.
 */
const openFormToolInput = z.object({
  form: assistantFormSchema,
  values: z.record(z.string(), z.unknown()).default({}),
});

/** The assistant's own tools (15 §3), all of read risk. */
export function helperTools(deps: HelperToolDeps): AssistantTool[] {
  const { events, conversations } = deps;
  return [
    {
      name: AssistantToolName.GetCurrentTime,
      description: "The user's current local date, time, weekday and time zone",
      input: getCurrentTimeInputSchema,
      mode: UiMode.Simple,
      handler: () => localTime(deps.clock.now(), deps.timeZone),
    },
    {
      name: AssistantToolName.GetAppStatus,
      description:
        'State of the app: whether the hosted opencode runs, the interface mode, and how many projects, active tasks and open items that need the user there are',
      input: getAppStatusInputSchema,
      mode: UiMode.Simple,
      handler: () => deps.appStatus(),
    },
    {
      name: AssistantToolName.OpenPage,
      description:
        'Show the user a page of the app next to this panel. task needs taskId, node needs taskId and nodeId, project and git_project need projectId, workflow needs workflowKey; on the task page nodeId selects a step',
      input: openPageInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const target = openPageInputSchema.parse(input);
        events.publish({ type: ServerEventType.AssistantNavigate, data: { conversationId: conversation.id, target } });
        return { opened: true };
      },
    },
    {
      name: AssistantToolName.OpenForm,
      description: `Open a form prefilled with the values you know; the user checks it, types any password or token and submits it. Never pass secrets. Forms and the fields you may prefill: ${FORM_FIELDS}`,
      input: openFormToolInput,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const parsed = openFormInputSchema.safeParse(input);
        if (!parsed.success) {
          throw new AppError(ErrorCode.ValidationFailed, 'Form values are invalid', { issues: parsed.error.issues });
        }
        const { form, values } = parsed.data;
        events.publish({
          type: ServerEventType.AssistantOpenForm,
          data: { conversationId: conversation.id, form, values },
        });
        return { opened: true };
      },
    },
    {
      name: AssistantToolName.ListFiles,
      description: 'Files you wrote in this conversation’s files directory',
      input: listFilesInputSchema,
      mode: UiMode.Simple,
      handler: (_input, { conversation }) => ({
        files: conversations.files(conversation.id).map(({ path, size, modifiedAt }) => ({ path, size, modifiedAt })),
      }),
    },
    {
      name: AssistantToolName.RevealFile,
      description:
        'Show one of your files in the system file manager; path is relative to the files directory, as list_files gives it',
      input: revealFileInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const { path } = revealFileInputSchema.parse(input);
        const dir = conversations.filesDir(conversation.id);
        const absolutePath = resolve(dir, path);
        const inside = relative(dir, absolutePath);
        // Paths come from the model (06 §11): only files of this conversation.
        if (
          inside.startsWith('..') ||
          isAbsolute(inside) ||
          !existsSync(absolutePath) ||
          !statSync(absolutePath).isFile()
        ) {
          throw new AppError(ErrorCode.ValidationFailed, `${path} is not a file of this conversation`, {
            issues: [{ path: ['path'], message: 'not a file of this conversation; call list_files' }],
          });
        }
        events.publish({
          type: ServerEventType.AssistantRevealFile,
          data: { conversationId: conversation.id, absolutePath },
        });
        return { revealed: true };
      },
    },
  ];
}
