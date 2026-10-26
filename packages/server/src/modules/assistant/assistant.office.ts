import {
  AssistantToolName,
  createDocxInputSchema,
  createXlsxInputSchema,
  editXlsxInputSchema,
  type OfficeFileWritten,
  type OfficeSource,
  reviseDocxInputSchema,
  UiMode,
} from '@aw/shared';
import type { AttachmentsService } from '../attachments/index.ts';
import type { Office } from '../office/index.ts';
import type { AssistantService } from './assistant.service.ts';
import type { AssistantTool } from './assistant.tools.ts';

export type OfficeToolDeps = { conversations: AssistantService; attachments: AttachmentsService; office: Office };

const KEPT_AS_IS = 'The source stays as it was. The result lists what the new file lacks of it (lost); tell the user';

/**
 * Word and Excel files the assistant writes (39 §7.2): always a new file in the conversation's files directory, never
 * one of the user's, so of read risk like its own file tools. Each appears as a file card in the conversation.
 */
export function officeTools({ conversations, attachments, office }: OfficeToolDeps): AssistantTool[] {
  /** A source the conversation may use: one of its attachments, or one of its files (39 §7.2). */
  function sourcePath(conversationId: string, source: OfficeSource): string {
    if ('file' in source) return conversations.fileOf(conversationId, source.file);
    conversations.assertOwnAttachments(conversationId, [source.attachment_id]);
    return attachments.originalPath(source.attachment_id);
  }

  /** Picks the new file's name, writes it and records its card. */
  async function write(
    conversationId: string,
    file: string,
    work: (out: string) => Promise<{ size: number; lost: OfficeFileWritten['lost'] }>,
  ): Promise<OfficeFileWritten> {
    const target = conversations.newFile(conversationId, file);
    const { size, lost } = await work(target.absolutePath);
    conversations.recordFile(conversationId, target.path, lost);
    return { file: target.path, size, lost };
  }

  return [
    {
      name: AssistantToolName.CreateDocx,
      description:
        'Write a new Word document (.docx) into this conversation’s files directory from blocks: headings, paragraphs, lists, tables, page breaks. In text, **bold**, *italic* and [text](https://…) are kept. style_from takes the fonts and heading styles of a Word document. A taken name gets a number; the result says the file written. The user sees it as a card they can preview, save and open',
      input: createDocxInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const docx = createDocxInputSchema.parse(input);
        const styleFrom = docx.style_from === undefined ? undefined : sourcePath(conversation.id, docx.style_from);
        return write(conversation.id, docx.file, (out) => office.createDocx(docx, out, styleFrom));
      },
    },
    {
      name: AssistantToolName.CreateXlsx,
      description:
        'Write a new Excel workbook (.xlsx) into this conversation’s files directory: each sheet has a header row (columns) and rows of values, { date } or { formula } cells. To put an attached workbook’s rows in a sheet, give rows_from (a query_sheet over it) instead of rows: the app copies every matching row. Text is always written as text. A taken name gets a number; the result says the file written',
      input: createXlsxInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const xlsx = createXlsxInputSchema.parse(input);
        const sources = xlsx.sheets.flatMap((sheet) =>
          sheet.rows_from === undefined ? [] : [sheet.rows_from.attachment_id],
        );
        conversations.assertOwnAttachments(conversation.id, [...new Set(sources)]);
        const workbooks = Object.fromEntries(sources.map((id) => [id, attachments.workbookPath(id)]));
        return write(conversation.id, xlsx.file, (out) => office.createXlsx(xlsx, out, workbooks));
      },
    },
    {
      name: AssistantToolName.EditXlsx,
      description: `Change an Excel workbook and save the result as a new file: set cells (values, { date }, { formula }), insert or delete rows and columns, add, rename or delete sheets, in order. Cell styles, column widths, merged cells and the other sheets are kept; charts and pivot tables are not, and formulas are not moved when rows or columns move. ${KEPT_AS_IS}`,
      input: editXlsxInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const edit = editXlsxInputSchema.parse(input);
        const source = sourcePath(conversation.id, edit.source);
        return write(conversation.id, edit.file, (out) => office.editXlsx(edit, source, out));
      },
    },
    {
      name: AssistantToolName.ReviseDocx,
      description: `Rewrite a Word document as a new file from blocks (as create_docx), keeping its styles: its fonts, sizes and heading styles. Its pictures, headers and footers, comments and page setup are not carried over. ${KEPT_AS_IS}`,
      input: reviseDocxInputSchema,
      mode: UiMode.Simple,
      handler(input, { conversation }) {
        const revise = reviseDocxInputSchema.parse(input);
        const source = sourcePath(conversation.id, revise.source);
        return write(conversation.id, revise.file, (out) => office.reviseDocx(revise, source, out));
      },
    },
  ];
}
