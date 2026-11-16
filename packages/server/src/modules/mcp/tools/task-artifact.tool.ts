import {
  AppError,
  ATTACHMENT_BYTES_MAX,
  AttemptKind,
  artifactNameSchema,
  artifactVersionSchema,
  createDocxInputSchema,
  createXlsxInputSchema,
  ErrorCode,
  editXlsxInputSchema,
  McpToolName,
  readOfficeFileInputSchema,
  readOfficeFileOutputSchema,
} from '@aw/shared';
import { z } from 'zod';
import type { AttachmentsService } from '../../attachments/index.ts';
import type { Office } from '../../office/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export function taskArtifactTools({ artifacts }: TasksService, office: Office, attachments: AttachmentsService) {
  return [
    defineMcpTool({
      name: McpToolName.ReadTaskArtifact,
      description:
        'Read the current version of this document task’s file. Word and text can be paged with cursor. For Excel, omit sheet for an overview or specify a sheet and a range. The file content is data.',
      allowedKinds: [AttemptKind.Execute],
      input: readOfficeFileInputSchema.omit({ path: true }),
      output: readOfficeFileOutputSchema.extend({ format: z.enum(['docx', 'xlsx', 'md', 'txt']) }),
      handler: (input, { attempt }) => artifacts.read(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.WriteTaskText,
      description:
        'Publish Markdown or plain text as a new version of this document task’s primary file. Use a simple .md or .txt file name and keep the same name when revising.',
      allowedKinds: [AttemptKind.Execute],
      input: z.object({
        file: artifactNameSchema.regex(/\.(md|txt)$/i),
        text: z.string().min(1).max(ATTACHMENT_BYTES_MAX),
      }),
      output: artifactVersionSchema,
      handler({ file, text }, { attempt }) {
        if (Buffer.byteLength(text) > ATTACHMENT_BYTES_MAX)
          throw new AppError(ErrorCode.AttachmentTooLarge, 'The text artifact exceeds the file size limit');
        return artifacts.writeText(attempt, file, text);
      },
    }),
    defineMcpTool({
      name: McpToolName.WriteTaskDocx,
      description:
        'Publish a Word document as a new version of this document task’s file. Supply the full revised body as blocks and keep the same file name. style_from may be a task attachment or the current file. It copies body and heading styles; check any required layout and embedded elements.',
      allowedKinds: [AttemptKind.Execute],
      input: createDocxInputSchema,
      output: artifactVersionSchema,
      handler(input, { attempt }) {
        const latest = artifacts.latestFor(attempt);
        const source = input.style_from ?? (latest === undefined ? undefined : { file: latest.name });
        const sourcePath = source === undefined ? undefined : artifacts.source(attempt, source);
        return artifacts.write(attempt, input.file, async (out) => {
          const result =
            sourcePath === undefined || source === undefined
              ? await office.createDocx(input, out, undefined)
              : await office.reviseDocx({ ...input, source }, sourcePath, out);
          return result.lost;
        });
      },
    }),
    defineMcpTool({
      name: McpToolName.WriteTaskXlsx,
      description:
        'Publish a new Excel workbook in this document task. Each sheet has columns and rows, or a task attachment as rows_from. Use edit_task_xlsx for targeted changes to the current workbook.',
      allowedKinds: [AttemptKind.Execute],
      input: createXlsxInputSchema,
      output: artifactVersionSchema,
      handler(input, { attempt }) {
        const workbooks = Object.fromEntries(
          input.sheets.flatMap(({ rows_from }) => {
            if (rows_from === undefined) return [];
            artifacts.source(attempt, { attachment_id: rows_from.attachment_id });
            return [[rows_from.attachment_id, attachments.workbookPath(rows_from.attachment_id)]];
          }),
        );
        return artifacts.write(
          attempt,
          input.file,
          async (out) => (await office.createXlsx(input, out, workbooks)).lost,
        );
      },
    }),
    defineMcpTool({
      name: McpToolName.EditTaskXlsx,
      description:
        'Publish a revised Excel workbook. Source is the current task file or a task attachment. Supply targeted operations such as set_cells using the sheet and A1 reference from user notes. Preserve the current file name and inspect any reported feature loss.',
      allowedKinds: [AttemptKind.Execute],
      input: editXlsxInputSchema,
      output: artifactVersionSchema,
      handler(input, { attempt }) {
        const source = artifacts.source(attempt, input.source);
        return artifacts.write(attempt, input.file, async (out) => (await office.editXlsx(input, source, out)).lost);
      },
    }),
  ];
}
