import { AppError, AttachmentFormat, AttachmentLimit, ErrorCode, OFFICE_CELLS_MAX, type OfficeMeta } from '@aw/shared';
import ExcelJS from 'exceljs';
import type { ZipEntry } from './office.zip.ts';

/** A cell as the model reads it: dates are ISO 8601, errors their text (`#DIV/0!`), rich text plain. */
export type WorkbookValue = string | number | boolean | null;
/** `c` is the 1-based column; `f` the formula, whose value is what the file cached (null when it cached none). */
export type WorkbookCell = { c: number; v: WorkbookValue; f?: string };
export type WorkbookRow = { r: number; hidden: boolean; cells: WorkbookCell[] };
export type WorkbookSheet = {
  name: string;
  hidden: boolean;
  /** The cells with content, e.g. `A1:F1204`; null for an empty sheet. */
  range: string | null;
  merges: string[];
  hiddenColumns: number[];
  rows: WorkbookRow[];
};
/** `workbook.json` of an Excel attachment (39 §5): what previews and the sheet tools read. */
export type Workbook = { sheets: WorkbookSheet[] };

/** `1` → `A`, `27` → `AA`. */
export function columnName(column: number): string {
  let name = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function isoDate(date: Date): string {
  const iso = date.toISOString();
  // Excel dates carry no time zone; exceljs reads them as UTC. Midnight is a plain date.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19);
}

function plain(value: ExcelJS.CellValue): WorkbookValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isoDate(value);
  if (typeof value !== 'object') return value;
  if ('richText' in value) return value.richText.map((run) => run.text).join('');
  if ('error' in value) return value.error;
  if ('hyperlink' in value) return typeof value.text === 'string' ? value.text : plain(value.text);
  if ('formula' in value || 'sharedFormula' in value) return plain(value.result ?? null);
  return null;
}

const tooManyCells = () =>
  new AppError(ErrorCode.AttachmentTooLarge, 'Cell limit exceeded', {
    reason: AttachmentLimit.Cells,
    limit: OFFICE_CELLS_MAX,
  });

/** Where a sheet's cells are: its first column, and how many rows and columns the range spans. */
type Extent = { left: number; rows: number; columns: number };

function readSheet(
  sheet: ExcelJS.Worksheet,
  counted: { cells: number; formulas: number },
): { sheet: WorkbookSheet; extent: Extent } {
  const rows: WorkbookRow[] = [];
  let [top, left, bottom, right] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0, 0];
  sheet.eachRow({ includeEmpty: false }, (row, r) => {
    const cells: WorkbookCell[] = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      // The covered cells of a merged area repeat its first cell's value; the merge itself is listed once.
      if (cell.type === ExcelJS.ValueType.Merge) return;
      counted.cells += 1;
      if (counted.cells > OFFICE_CELLS_MAX) throw tooManyCells();
      const formula = cell.type === ExcelJS.ValueType.Formula ? cell.formula : undefined;
      if (formula !== undefined) counted.formulas += 1;
      cells.push(formula === undefined ? { c, v: plain(cell.value) } : { c, v: plain(cell.value), f: formula });
      [top, left, bottom, right] = [Math.min(top, r), Math.min(left, c), Math.max(bottom, r), Math.max(right, c)];
    });
    if (cells.length > 0) rows.push({ r, hidden: row.hidden, cells });
  });
  const hiddenColumns: number[] = [];
  for (let c = 1; c <= sheet.columnCount; c++) if (sheet.getColumn(c).hidden) hiddenColumns.push(c);
  const empty = rows.length === 0;
  return {
    sheet: {
      name: sheet.name,
      hidden: sheet.state !== 'visible',
      range: empty ? null : `${columnName(left)}${top}:${columnName(right)}${bottom}`,
      merges: sheet.model.merges,
      hiddenColumns,
      rows,
    },
    extent: empty ? { left: 1, rows: 0, columns: 0 } : { left, rows: bottom - top + 1, columns: right - left + 1 },
  };
}

const cellText = (cell: WorkbookCell) =>
  (cell.v === null && cell.f !== undefined ? `=${cell.f}` : String(cell.v ?? ''))
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, '<br>');

/**
 * One section per sheet (39 §5.3): a Markdown table whose first column is the row number and whose header is the
 * column letters, so the model can name cells as `C17`.
 */
function sheetText(sheet: WorkbookSheet, { left, rows, columns }: Extent): string {
  const notes = [sheet.range === null ? '空' : `${sheet.range}，${rows} 行 × ${columns} 列`];
  if (sheet.hidden) notes.push('隐藏的工作表');
  const lines = [`## 工作表「${sheet.name}」（${notes.join('，')}）`];
  if (sheet.merges.length > 0) lines.push(`合并单元格：${sheet.merges.join('、')}`);
  if (sheet.hiddenColumns.length > 0) lines.push(`隐藏的列：${sheet.hiddenColumns.map(columnName).join('、')}`);
  if (sheet.range === null) return lines.join('\n');
  const letters = Array.from({ length: columns }, (_, i) => columnName(left + i));
  lines.push('', `| 行 | ${letters.join(' | ')} |`, `| --- | ${letters.map(() => '---').join(' | ')} |`);
  for (const row of sheet.rows) {
    const cells = Array<string>(columns).fill('');
    for (const cell of row.cells) cells[cell.c - left] = cellText(cell);
    lines.push(`| ${row.r}${row.hidden ? '（隐藏）' : ''} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const countOf = (entries: readonly ZipEntry[], pattern: RegExp) => entries.filter((e) => pattern.test(e.name)).length;

/** An Excel workbook's cells and its text for the model (39 §5.3); formulas are not recalculated. */
export async function readXlsx(
  bytes: Buffer,
  entries: readonly ZipEntry[],
): Promise<{ text: string; workbook: Workbook; meta: OfficeMeta }> {
  const book = new ExcelJS.Workbook();
  // exceljs declares its own Buffer type, which Node's Buffer satisfies at runtime.
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const counted = { cells: 0, formulas: 0 };
  const read = book.worksheets.map((sheet) => readSheet(sheet, counted));
  return {
    text: `${read.map(({ sheet, extent }) => sheetText(sheet, extent)).join('\n\n')}\n`,
    workbook: { sheets: read.map(({ sheet }) => sheet) },
    meta: {
      format: AttachmentFormat.Xlsx,
      sheets: read.map(({ sheet, extent }) => ({
        name: sheet.name,
        range: sheet.range,
        rows: extent.rows,
        columns: extent.columns,
        hidden: sheet.hidden,
      })),
      formulas: counted.formulas,
      charts: countOf(entries, /^xl\/charts\/chart\d*\.xml$/),
      images: countOf(entries, /^xl\/media\//),
      pivotTables: countOf(entries, /^xl\/pivotTables\/[^/]+\.xml$/),
    },
  };
}
