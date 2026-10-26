import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  ATTACHMENT_READ_MAX_CHARS,
  AttachmentFormat,
  AttachmentLimit,
  ErrorCode,
  OFFICE_ATTACHMENT_BYTES_MAX,
  OFFICE_PREVIEW_ROWS,
  OFFICE_UNZIPPED_BYTES_MAX,
  type OfficeFilePreviewDTO,
  type OfficeMeta,
  type ReadOfficeFileInput,
  type ReadOfficeFileOutput,
} from '@aw/shared';
import { detectFormat } from './office.detect.ts';
import { readDocx } from './office.docx.ts';
import { OFFICE_TEXT_FILE, type OfficeFormat, OVERVIEW_FILE, WORKBOOK_FILE } from './office.job.ts';
import { pageText } from './office.sheet-text.ts';
import { readSheetPage, sheetPreview } from './office.sheets.ts';
import { readXlsx } from './office.xlsx.ts';
import { assertUnzipsWithin, corrupt, zipEntries } from './office.zip.ts';

export async function translated<T>(format: OfficeFormat, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Translation: mammoth and exceljs throw plain errors on damaged parts.
    throw corrupt(`Cannot read the ${format} file: ${String(err)}`);
  }
}

/** A Word or Excel file that was not uploaded (a file written in a conversation, one of a repository), checked as an upload. */
async function officeBytes(file: string) {
  const bytes = await readFile(file);
  if (bytes.length > OFFICE_ATTACHMENT_BYTES_MAX) {
    throw new AppError(ErrorCode.AttachmentTooLarge, 'Over the Word / Excel size limit', {
      reason: AttachmentLimit.Bytes,
      limit: OFFICE_ATTACHMENT_BYTES_MAX,
    });
  }
  const format = detectFormat(bytes);
  if (format === AttachmentFormat.Text) {
    const message = 'Not a Word or Excel file; read it as text';
    throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['path'], message }] });
  }
  const entries = zipEntries(bytes);
  await assertUnzipsWithin(bytes, entries, OFFICE_UNZIPPED_BYTES_MAX);
  return { bytes, format, entries };
}

/**
 * A Word or Excel file read in memory for a preview (39 §8.2): the same checks as an upload, nothing written. An
 * Excel file gives its sheet `sheet`, or the first.
 */
export async function previewOffice(file: string, sheet: string | undefined): Promise<OfficeFilePreviewDTO> {
  const { bytes, format, entries } = await officeBytes(file);
  if (format === AttachmentFormat.Docx) {
    const { text, meta } = await translated(format, () => readDocx(bytes));
    return { format, meta, markdown: text };
  }
  const { workbook, meta } = await translated(format, () => readXlsx(bytes, entries));
  const name = sheet ?? workbook.sheets[0]?.name ?? '';
  return { format, meta, sheet: sheetPreview(workbook, name, OFFICE_PREVIEW_ROWS) };
}

/**
 * `read_office_file` (39 §7.3): a Word document's Markdown a page at a time; a workbook's overview, or one sheet's
 * rows a page at a time.
 */
export async function readOfficeFile(
  file: string,
  { path, sheet, range, cursor }: ReadOfficeFileInput,
): Promise<ReadOfficeFileOutput> {
  const { bytes, format, entries } = await officeBytes(file);
  if (format === AttachmentFormat.Docx) {
    const { text } = await translated(format, () => readDocx(bytes));
    const end = cursor + ATTACHMENT_READ_MAX_CHARS;
    const next = end < text.length ? end : null;
    return {
      path,
      format,
      text: text.slice(cursor, end),
      total_chars: text.length,
      next_cursor: next,
      next_range: null,
    };
  }
  const { workbook, overview } = await translated(format, () => readXlsx(bytes, entries));
  if (sheet === undefined) {
    // Cut at a line: the sheets' rows are read with `sheet`.
    const text =
      overview.length <= ATTACHMENT_READ_MAX_CHARS
        ? overview
        : `${overview.slice(0, overview.lastIndexOf('\n', ATTACHMENT_READ_MAX_CHARS))}\n…`;
    return { path, format, text, total_chars: null, next_cursor: null, next_range: null };
  }
  const page = readSheetPage(workbook, { sheet, range, include_formulas: false });
  return { path, format, text: pageText(page), total_chars: null, next_cursor: null, next_range: page.next_range };
}

/** Reads `source` and writes what is derived from it into `outDir` (39 §5). */
export async function parseOffice(format: OfficeFormat, source: string, outDir: string): Promise<OfficeMeta> {
  const bytes = await readFile(source);
  const entries = zipEntries(bytes);
  await assertUnzipsWithin(bytes, entries, OFFICE_UNZIPPED_BYTES_MAX);
  if (format === AttachmentFormat.Docx) {
    const { text, meta } = await translated(format, () => readDocx(bytes));
    await writeFile(join(outDir, OFFICE_TEXT_FILE), text);
    return meta;
  }
  const { text, overview, workbook, meta } = await translated(format, () => readXlsx(bytes, entries));
  await writeFile(join(outDir, OFFICE_TEXT_FILE), text);
  await writeFile(join(outDir, WORKBOOK_FILE), JSON.stringify(workbook));
  await writeFile(join(outDir, OVERVIEW_FILE), overview);
  return meta;
}
