import {
  AssistantToolName,
  createDocxInputSchema,
  createXlsxInputSchema,
  type OfficeFileWritten,
  UiMode,
} from '@aw/shared';
import type { AttachmentsService } from '../attachments/index.ts';
import type { Office } from '../office/index.ts';
import type { AssistantService } from './assistant.service.ts';
import type { AssistantTool } from './assistant.tools.ts';

export type OfficeToolDeps = { conversations: AssistantService; attachments: AttachmentsService; office: Office };

/**
 * Word and Excel files the assistant writes (39 §7.2): always a new file in the conversation's files directory, never
 * one of the user's, so of read risk like its own file tools. Each appears as a file card in the conversation.
 */
export function officeTools({ conversations, attachments, office }: OfficeToolDeps): AssistantTool[] {
  return [
    {
      name: AssistantToolName.CreateDocx,
      description:
        'Write a new Word document (.docx) into this conversation’s files directory from blocks: headings, paragraphs, lists, tables, page breaks. In text, **bold**, *italic* and [text](https://…) are kept. A taken name gets a number; the result says the file written. The user sees it as a card they can preview, save and open',
      input: createDocxInputSchema,
      mode: UiMode.Simple,
      async handler(input, { conversation }): Promise<OfficeFileWritten> {
        const docx = createDocxInputSchema.parse(input);
        const target = conversations.newFile(conversation.id, docx.file);
        const { size } = await office.createDocx(docx, target.absolutePath);
        conversations.recordFile(conversation.id, target.path);
        return { file: target.path, size };
      },
    },
    {
      name: AssistantToolName.CreateXlsx,
      description:
        'Write a new Excel workbook (.xlsx) into this conversation’s files directory: each sheet has a header row (columns) and rows of values, { date } or { formula } cells. To put an attached workbook’s rows in a sheet, give rows_from (a query_sheet over it) instead of rows: the app copies every matching row. Text is always written as text. A taken name gets a number; the result says the file written',
      input: createXlsxInputSchema,
      mode: UiMode.Simple,
      async handler(input, { conversation }): Promise<OfficeFileWritten> {
        const xlsx = createXlsxInputSchema.parse(input);
        const sources = xlsx.sheets.flatMap((sheet) =>
          sheet.rows_from === undefined ? [] : [sheet.rows_from.attachment_id],
        );
        conversations.assertOwnAttachments(conversation.id, [...new Set(sources)]);
        const workbooks = Object.fromEntries(sources.map((id) => [id, attachments.workbookPath(id)]));
        const target = conversations.newFile(conversation.id, xlsx.file);
        const { size } = await office.createXlsx(xlsx, target.absolutePath, workbooks);
        conversations.recordFile(conversation.id, target.path);
        return { file: target.path, size };
      },
    },
  ];
}
