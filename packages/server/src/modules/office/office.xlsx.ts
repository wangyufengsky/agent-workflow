import { AppError, AttachmentFormat, AttachmentLimit, ErrorCode, OFFICE_CELLS_MAX, type OfficeMeta } from '@aw/shared';
import ExcelJS from 'exceljs';
import { workbookOverview, workbookText } from './office.sheet-text.ts';
import {
  columnName,
  extentOf,
  type Workbook,
  type WorkbookCell,
  type WorkbookRow,
  type WorkbookSheet,
  type WorkbookValue,
} from './office.workbook.ts';
import type { ZipEntry } from './office.zip.ts';

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

function readSheet(sheet: ExcelJS.Worksheet, counted: { cells: number; formulas: number }): WorkbookSheet {
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
  return {
    name: sheet.name,
    hidden: sheet.state !== 'visible',
    range: rows.length === 0 ? null : `${columnName(left)}${top}:${columnName(right)}${bottom}`,
    merges: sheet.model.merges,
    hiddenColumns,
    rows,
  };
}

const countOf = (entries: readonly ZipEntry[], pattern: RegExp) => entries.filter((e) => pattern.test(e.name)).length;

/**
 * An Excel workbook's cells, its full text and the prompt's overview of it (39 §5.3, §6.1); formulas are not
 * recalculated.
 */
export async function readXlsx(
  bytes: Buffer,
  entries: readonly ZipEntry[],
): Promise<{ text: string; overview: string; workbook: Workbook; meta: OfficeMeta }> {
  const book = new ExcelJS.Workbook();
  // exceljs declares its own Buffer type, which Node's Buffer satisfies at runtime.
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const counted = { cells: 0, formulas: 0 };
  const workbook: Workbook = { sheets: book.worksheets.map((sheet) => readSheet(sheet, counted)) };
  const meta: OfficeMeta = {
    format: AttachmentFormat.Xlsx,
    sheets: workbook.sheets.map((sheet) => {
      const { rows, columns } = extentOf(sheet);
      return { name: sheet.name, range: sheet.range, rows, columns, hidden: sheet.hidden };
    }),
    formulas: counted.formulas,
    charts: countOf(entries, /^xl\/charts\/chart\d*\.xml$/),
    images: countOf(entries, /^xl\/media\//),
    pivotTables: countOf(entries, /^xl\/pivotTables\/[^/]+\.xml$/),
  };
  return { text: workbookText(workbook), overview: workbookOverview(workbook, meta), workbook, meta };
}
