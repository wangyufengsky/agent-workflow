import {
  AppError,
  assertNever,
  type CreateDocxInput,
  type DocxBlock,
  ErrorCode,
  OFFICE_WRITE_CELLS_MAX,
  type XlsxCell,
  type XlsxColumnType,
  type XlsxSheet,
} from '@aw/shared';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { querySheet } from './office.sheets.ts';
import type { Workbook, WorkbookValue } from './office.workbook.ts';

/** Latin text in Calibri, Chinese in 等线, as Word's own default documents. */
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '等线' };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const ORDERED = 'ordered';
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** `**bold**`, `*italic*` and `[text](https://…)` as runs; anything else stays plain text (39 §7.2). */
function runs(text: string): Array<TextRun | ExternalHyperlink> {
  const out: Array<TextRun | ExternalHyperlink> = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) out.push(new TextRun(text.slice(at, match.index)));
    const [, bold, italic, label, link] = match;
    if (bold !== undefined) out.push(new TextRun({ text: bold, bold: true }));
    else if (italic !== undefined) out.push(new TextRun({ text: italic, italics: true }));
    else
      out.push(
        new ExternalHyperlink({
          link: link as string,
          children: [new TextRun({ text: label as string, style: 'Hyperlink' })],
        }),
      );
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(new TextRun(text.slice(at)));
  return out;
}

function table({ header, rows }: Extract<DocxBlock, { type: 'table' }>): Table {
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const line = (cells: readonly string[], bold: boolean) =>
    new TableRow({
      tableHeader: bold,
      children: Array.from(
        { length: width },
        (_, i) =>
          new TableCell({
            children: [
              new Paragraph({ children: bold ? [new TextRun({ text: cells[i] ?? '', bold })] : runs(cells[i] ?? '') }),
            ],
          }),
      ),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [line(header, true), ...rows.map((row) => line(row, false))],
  });
}

/** Each ordered list counts from 1: its own instance of the numbering. */
function blocks(items: readonly DocxBlock[]): Array<Paragraph | Table> {
  let lists = 0;
  return items.flatMap((block) => {
    switch (block.type) {
      case 'heading':
        return [
          new Paragraph({
            heading: HEADINGS[block.level - 1] as (typeof HEADINGS)[number],
            children: runs(block.text),
          }),
        ];
      case 'paragraph':
        return [new Paragraph({ children: runs(block.text) })];
      case 'list': {
        lists += 1;
        const instance = lists;
        return block.items.map(
          (item) =>
            new Paragraph({
              children: runs(item),
              ...(block.ordered ? { numbering: { reference: ORDERED, level: 0, instance } } : { bullet: { level: 0 } }),
            }),
        );
      }
      case 'table':
        // An empty paragraph after it: Word joins two tables that touch.
        return [table(block), new Paragraph({})];
      case 'page_break':
        return [new Paragraph({ children: [new PageBreak()] })];
      default:
        return assertNever(block);
    }
  });
}

/** A new Word document (39 §7.2): the app lays out what the model wrote as blocks. */
export async function writeDocx({ title, blocks: items }: CreateDocxInput): Promise<Buffer> {
  const document = new Document({
    ...(title === undefined ? {} : { title }),
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              style: { paragraph: { indent: { left: 420, hanging: 420 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children: blocks(items) }],
  });
  return Packer.toBuffer(document);
}

const FORMATS: Record<XlsxColumnType, string | undefined> = {
  text: undefined,
  number: '#,##0.##',
  date: 'yyyy-mm-dd',
  percent: '0.00%',
  currency: '#,##0.00',
};

function cellValue(cell: XlsxCell | WorkbookValue): ExcelJS.CellValue {
  if (cell === null || typeof cell !== 'object') return cell;
  if ('date' in cell) return new Date(`${cell.date}T00:00:00Z`);
  // Without the leading =, as exceljs writes it.
  return { formula: cell.formula.replace(/^=/, '') };
}

/** A sheet filled from a query over an attached workbook (`rows_from`): its header row and data rows. */
export type SheetSource = { columns: string[]; rows: WorkbookValue[][] };

/**
 * A new Excel workbook (39 §7.2): a bold, frozen header row per sheet, column formats by type. Text is always written
 * as text (a string starting with `=` does not become a formula); only `{ formula }` cells are formulas, checked
 * against the unsafe functions by the input schema.
 */
export async function writeXlsx(
  sheets: readonly XlsxSheet[],
  sourceOf: (sheet: XlsxSheet) => Promise<SheetSource | undefined>,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  let cells = 0;
  for (const spec of sheets) {
    const source = await sourceOf(spec);
    const headers = spec.columns?.map((c) => c.header) ?? source?.columns ?? [];
    const rows: ReadonlyArray<ReadonlyArray<XlsxCell | WorkbookValue>> = spec.rows ?? source?.rows ?? [];
    cells += rows.reduce((n, row) => n + row.length, 0);
    if (cells > OFFICE_WRITE_CELLS_MAX) {
      const message = `The workbook would have over ${OFFICE_WRITE_CELLS_MAX} cells; narrow rows_from with where or columns`;
      throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['sheets'], message }] });
    }
    const sheet = book.addWorksheet(spec.name, spec.freeze_header ? { views: [{ state: 'frozen', ySplit: 1 }] } : {});
    sheet.columns = headers.map((header, i) => {
      const column = spec.columns?.[i];
      const format = column === undefined ? undefined : FORMATS[column.type];
      const longest = Math.max(header.length, ...rows.slice(0, 200).map((row) => String(row[i] ?? '').length));
      return {
        header,
        width: column?.width ?? Math.min(Math.max(longest + 2, 8), 60),
        ...(format === undefined ? {} : { style: { numFmt: format } }),
      };
    });
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row.map(cellValue));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** `rows_from` (39 §7.2): every row the query matches, as many as the cell limit lets through. */
export function sourceRows(workbook: Workbook, query: NonNullable<XlsxSheet['rows_from']>): SheetSource {
  const { columns, rows } = querySheet(workbook, { ...query, limit: OFFICE_WRITE_CELLS_MAX });
  return { columns, rows };
}
