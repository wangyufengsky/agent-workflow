import { readFile } from 'node:fs/promises';
import {
  AppError,
  AttachmentFormat,
  AttachmentLimit,
  ErrorCode,
  OFFICE_ATTACHMENT_BYTES_MAX,
  OFFICE_UNZIPPED_BYTES_MAX,
  OfficeLoss,
  type OfficeLossItem,
  type ReviseDocxInput,
  type XlsxEdit,
} from '@aw/shared';
import ExcelJS from 'exceljs';
import { detectFormat } from './office.detect.ts';
import type { OfficeFormat } from './office.job.ts';
import { translated } from './office.parse.ts';
import { columnNumber } from './office.workbook.ts';
import { cellValue, writeDocx } from './office.write.ts';
import { workbookParts } from './office.xlsx.ts';
import { assertUnzipsWithin, readZipEntry, zipEntries } from './office.zip.ts';

/** `word/styles.xml` is a few hundred KiB at most; past this the file is not a document to borrow styles from. */
const STYLES_MAX_BYTES = 8 * 1024 * 1024;

const invalid = (path: string, message: string) =>
  new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: path.split('.'), message }] });

/**
 * A file to start from (39 §7.2), checked as an upload is: within the size limits, and the format the tool needs. An
 * attachment passed these when it was saved; a file the assistant wrote has not.
 */
export async function readSource(path: string, format: OfficeFormat): Promise<Buffer> {
  const bytes = await readFile(path);
  if (bytes.length > OFFICE_ATTACHMENT_BYTES_MAX) {
    throw new AppError(ErrorCode.AttachmentTooLarge, 'Over the Word / Excel size limit', {
      reason: AttachmentLimit.Bytes,
      limit: OFFICE_ATTACHMENT_BYTES_MAX,
    });
  }
  if (detectFormat(bytes) !== format) {
    throw invalid(
      'source',
      `The source is not ${format === AttachmentFormat.Docx ? 'a Word document' : 'an Excel workbook'}`,
    );
  }
  await assertUnzipsWithin(bytes, zipEntries(bytes), OFFICE_UNZIPPED_BYTES_MAX);
  return bytes;
}

/** A Word document's own styles, for a document written to look like it (39 §7.2). */
export function documentStyles(bytes: Buffer): string | undefined {
  const entry = zipEntries(bytes).find((e) => e.name === 'word/styles.xml');
  return entry === undefined ? undefined : readZipEntry(bytes, entry, STYLES_MAX_BYTES).toString('utf8');
}

const lossesOf = (counts: ReadonlyArray<readonly [OfficeLoss, number]>): OfficeLossItem[] =>
  counts.filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count }));

/**
 * `revise_docx` (39 §7.2): the blocks with the source's styles. Everything else of the source is not carried over;
 * its pictures, headers and footers and comments are reported lost.
 */
export async function reviseDocx(source: Buffer, input: Pick<ReviseDocxInput, 'title' | 'blocks'>) {
  const names = zipEntries(source).map((e) => e.name);
  const count = (pattern: RegExp) => names.filter((name) => pattern.test(name)).length;
  const bytes = await writeDocx(input, documentStyles(source));
  const lost = lossesOf([
    [OfficeLoss.Images, count(/^word\/media\//)],
    [OfficeLoss.HeadersFooters, count(/^word\/(header|footer)\d*\.xml$/)],
    [OfficeLoss.Comments, count(/^word\/comments\.xml$/)],
  ]);
  return { bytes, lost };
}

function formulasIn(book: ExcelJS.Workbook): number {
  let formulas = 0;
  for (const sheet of book.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulas += 1;
      }),
    );
  }
  return formulas;
}

/** A sheet name as a formula writes it: plain when it is letters and digits, quoted otherwise. */
const sheetRef = (name: string) => (/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) ? name : `'${name.replaceAll("'", "''")}'`);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `明细!A1` and `'明细'!A1`, not `新明细!A1`; sheet names compare without case, as Excel's do. */
const referencesTo = (name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_.'])(?:'${escapeRegExp(name.replaceAll("'", "''"))}'|${escapeRegExp(name)})!`, 'giu');

/**
 * Each formula a sheet writes itself (a shared formula's other cells follow its first): `edit` returns the new text,
 * or undefined to leave it.
 */
function eachFormula(book: ExcelJS.Workbook, edit: (formula: string) => string | undefined): void {
  for (const sheet of book.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type !== ExcelJS.ValueType.Formula) return;
        const value = cell.value as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue;
        if ('sharedFormula' in value || value.formula === undefined) return;
        const changed = edit(value.formula);
        if (changed !== undefined) cell.value = { ...value, formula: changed };
      }),
    );
  }
}

type Merge = { top: number; left: number; bottom: number; right: number };

/**
 * A merged range after columns `at`… change: `deleted` taken out, then `inserted` put in. A range they fall inside
 * grows or shrinks; one reduced to a single cell is no merge.
 */
function shiftColumns(m: Merge, at: number, deleted: number, inserted: number): Merge | undefined {
  let { left, right } = m;
  if (deleted > 0) {
    const last = at + deleted - 1;
    if (right >= at) right = right > last ? right - deleted : at - 1;
    if (left >= at) left = left > last ? left - deleted : at;
    if (right < left) return undefined;
  }
  if (inserted > 0) {
    if (left >= at) left += inserted;
    if (right >= at) right += inserted;
  }
  return left === right && m.top === m.bottom ? undefined : { ...m, left, right };
}

/**
 * exceljs moves cells but not merged ranges when columns move (its rows keep theirs), and a range left in place
 * hides the cells moved under it: the ranges are taken off, the columns moved, the moved ranges put back.
 */
function spliceColumns(sheet: ExcelJS.Worksheet, at: number, deleted: number, inserted: number): void {
  const merges = sheet.model.merges.map((range): Merge => {
    const [from, to] = range.split(':').map((ref) => {
      const [, letters = '', digits = ''] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
      return { row: Number(digits), column: columnNumber(letters) };
    }) as [{ row: number; column: number }, { row: number; column: number }];
    return { top: from.row, left: from.column, bottom: to.row, right: to.column };
  });
  for (const range of sheet.model.merges) sheet.unMergeCells(range);
  sheet.spliceColumns(at, deleted, ...Array.from({ length: inserted }, () => []));
  for (const merge of merges) {
    const moved = shiftColumns(merge, at, deleted, inserted);
    if (moved !== undefined) sheet.mergeCells(moved.top, moved.left, moved.bottom, moved.right);
  }
}

/**
 * One change; rows and columns are those of the workbook as the earlier changes left it. Returns how many formulas
 * it left pointing at something gone (a deleted sheet).
 */
function apply(book: ExcelJS.Workbook, op: XlsxEdit, at: string): number {
  const sheetOf = (name: string) => {
    const sheet = book.getWorksheet(name);
    if (sheet === undefined) {
      const names = book.worksheets.map((s) => `"${s.name}"`).join(', ');
      throw invalid(`${at}.sheet`, `No sheet named "${name}"; the sheets are ${names}`);
    }
    return sheet;
  };
  const nameFree = (name: string) => {
    if (book.worksheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw invalid(`${at}.name`, `A sheet named "${name}" exists already`);
    }
  };
  const empty = (count: number) => Array.from({ length: count }, () => []);
  switch (op.op) {
    case 'set_cells': {
      const sheet = sheetOf(op.sheet);
      const [, letters = '', digits = ''] = /^([A-Z]+)(\d+)$/.exec(op.start) ?? [];
      const [top, left] = [Number(digits), columnNumber(letters)];
      op.values.forEach((row, i) => {
        row.forEach((value, j) => {
          sheet.getCell(top + i, left + j).value = cellValue(value);
        });
      });
      return 0;
    }
    case 'insert_rows':
      sheetOf(op.sheet).spliceRows(op.before, 0, ...empty(op.count));
      return 0;
    case 'delete_rows':
      sheetOf(op.sheet).spliceRows(op.from, op.count);
      return 0;
    case 'insert_columns':
      spliceColumns(sheetOf(op.sheet), columnNumber(op.before), 0, op.count);
      return 0;
    case 'delete_columns':
      spliceColumns(sheetOf(op.sheet), columnNumber(op.from), op.count, 0);
      return 0;
    case 'add_sheet':
      nameFree(op.name);
      book.addWorksheet(op.name);
      return 0;
    case 'rename_sheet': {
      const sheet = sheetOf(op.sheet);
      if (op.name.toLowerCase() !== op.sheet.toLowerCase()) nameFree(op.name);
      // exceljs renames only the sheet: the formulas that name it follow here.
      const old = referencesTo(sheet.name);
      eachFormula(book, (formula) =>
        formula.search(old) >= 0 ? formula.replace(old, `${sheetRef(op.name)}!`) : undefined,
      );
      sheet.name = op.name;
      return 0;
    }
    case 'delete_sheet': {
      const sheet = sheetOf(op.sheet);
      if (book.worksheets.length === 1) throw invalid(`${at}.sheet`, 'A workbook keeps at least one sheet');
      book.removeWorksheet(sheet.id);
      const gone = referencesTo(sheet.name);
      let broken = 0;
      eachFormula(book, (formula) => {
        if (formula.search(gone) >= 0) broken += 1;
        return undefined;
      });
      return broken;
    }
  }
}

const MOVES = new Set<XlsxEdit['op']>(['insert_rows', 'delete_rows', 'insert_columns', 'delete_columns']);

/**
 * `edit_xlsx` (39 §7.2): the changes made on a copy of the source, which keeps its cell styles, widths, merges and
 * other sheets; merged ranges move with columns and formulas follow a renamed sheet. exceljs drops charts and pivot
 * tables and moves no formula when rows or columns move, and a deleted sheet's formulas break: all reported.
 */
export async function editXlsx(source: Buffer, operations: readonly XlsxEdit[]) {
  const book = new ExcelJS.Workbook();
  await translated(AttachmentFormat.Xlsx, () => book.xlsx.load(source as unknown as ExcelJS.Buffer));
  const formulas = formulasIn(book);
  let broken = 0;
  for (const [i, op] of operations.entries()) broken += apply(book, op, `operations.${i}`);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const [before, after] = [workbookParts(zipEntries(source)), workbookParts(zipEntries(bytes))];
  const moved = operations.some((op) => MOVES.has(op.op));
  const lost = lossesOf([
    [OfficeLoss.Charts, before.charts - after.charts],
    [OfficeLoss.Images, before.images - after.images],
    [OfficeLoss.PivotTables, before.pivotTables - after.pivotTables],
    // After moved rows or columns any formula may point at the wrong cells; otherwise only those naming a deleted sheet.
    [OfficeLoss.FormulaReferences, moved ? formulas : broken],
  ]);
  return { bytes, lost };
}
