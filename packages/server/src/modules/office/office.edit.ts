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

/** One change; rows and columns are those of the workbook as the earlier changes left it. */
function apply(book: ExcelJS.Workbook, op: XlsxEdit, at: string): void {
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
      return;
    }
    case 'insert_rows':
      sheetOf(op.sheet).spliceRows(op.before, 0, ...empty(op.count));
      return;
    case 'delete_rows':
      sheetOf(op.sheet).spliceRows(op.from, op.count);
      return;
    case 'insert_columns':
      sheetOf(op.sheet).spliceColumns(columnNumber(op.before), 0, ...empty(op.count));
      return;
    case 'delete_columns':
      sheetOf(op.sheet).spliceColumns(columnNumber(op.from), op.count);
      return;
    case 'add_sheet':
      nameFree(op.name);
      book.addWorksheet(op.name);
      return;
    case 'rename_sheet': {
      const sheet = sheetOf(op.sheet);
      if (op.name.toLowerCase() !== op.sheet.toLowerCase()) nameFree(op.name);
      sheet.name = op.name;
      return;
    }
    case 'delete_sheet': {
      const sheet = sheetOf(op.sheet);
      if (book.worksheets.length === 1) throw invalid(`${at}.sheet`, 'A workbook keeps at least one sheet');
      book.removeWorksheet(sheet.id);
      return;
    }
  }
}

const MOVES = new Set<XlsxEdit['op']>(['insert_rows', 'delete_rows', 'insert_columns', 'delete_columns']);

/**
 * `edit_xlsx` (39 §7.2): the changes made on a copy of the source, which keeps its cell styles, widths, merges and
 * other sheets. exceljs drops charts and pivot tables, and moves no formula when rows or columns move: all reported.
 */
export async function editXlsx(source: Buffer, operations: readonly XlsxEdit[]) {
  const book = new ExcelJS.Workbook();
  await translated(AttachmentFormat.Xlsx, () => book.xlsx.load(source as unknown as ExcelJS.Buffer));
  const formulas = formulasIn(book);
  for (const [i, op] of operations.entries()) apply(book, op, `operations.${i}`);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const [before, after] = [workbookParts(zipEntries(source)), workbookParts(zipEntries(bytes))];
  const moved = operations.some((op) => MOVES.has(op.op));
  const lost = lossesOf([
    [OfficeLoss.Charts, before.charts - after.charts],
    [OfficeLoss.Images, before.images - after.images],
    [OfficeLoss.PivotTables, before.pivotTables - after.pivotTables],
    [OfficeLoss.FormulaReferences, moved ? formulas : 0],
  ]);
  return { bytes, lost };
}
