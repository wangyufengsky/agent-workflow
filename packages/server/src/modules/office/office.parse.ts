import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  AttachmentFormat,
  AttachmentLimit,
  ErrorCode,
  OFFICE_ATTACHMENT_BYTES_MAX,
  OFFICE_PREVIEW_ROWS,
  OFFICE_UNZIPPED_BYTES_MAX,
  type OfficeFilePreviewDTO,
  type OfficeMeta,
} from '@aw/shared';
import { detectFormat } from './office.detect.ts';
import { readDocx } from './office.docx.ts';
import { OFFICE_TEXT_FILE, type OfficeFormat, OVERVIEW_FILE, WORKBOOK_FILE } from './office.job.ts';
import { sheetPreview } from './office.sheets.ts';
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

/**
 * A Word or Excel file read in memory for a preview (39 §8.2): the same checks as an upload, nothing written. An
 * Excel file gives its sheet `sheet`, or the first.
 */
export async function previewOffice(file: string, sheet: string | undefined): Promise<OfficeFilePreviewDTO> {
  const bytes = await readFile(file);
  if (bytes.length > OFFICE_ATTACHMENT_BYTES_MAX) {
    throw new AppError(ErrorCode.AttachmentTooLarge, 'Over the Word / Excel size limit', {
      reason: AttachmentLimit.Bytes,
      limit: OFFICE_ATTACHMENT_BYTES_MAX,
    });
  }
  const format = detectFormat(bytes);
  if (format === AttachmentFormat.Text) {
    const message = 'Not a Word or Excel file';
    throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['path'], message }] });
  }
  const entries = zipEntries(bytes);
  await assertUnzipsWithin(bytes, entries, OFFICE_UNZIPPED_BYTES_MAX);
  if (format === AttachmentFormat.Docx) {
    const { text, meta } = await translated(format, () => readDocx(bytes));
    return { format, meta, markdown: text };
  }
  const { workbook, meta } = await translated(format, () => readXlsx(bytes, entries));
  const name = sheet ?? workbook.sheets[0]?.name ?? '';
  return { format, meta, sheet: sheetPreview(workbook, name, OFFICE_PREVIEW_ROWS) };
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
