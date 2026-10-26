import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, AttachmentFormat, OFFICE_UNZIPPED_BYTES_MAX, type OfficeMeta } from '@aw/shared';
import { readDocx } from './office.docx.ts';
import { OFFICE_TEXT_FILE, type OfficeFormat, OVERVIEW_FILE, WORKBOOK_FILE } from './office.job.ts';
import { readXlsx } from './office.xlsx.ts';
import { assertUnzipsWithin, corrupt, zipEntries } from './office.zip.ts';

async function translated<T>(format: OfficeFormat, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Translation: mammoth and exceljs throw plain errors on damaged parts.
    throw corrupt(`Cannot read the ${format} file: ${String(err)}`);
  }
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
