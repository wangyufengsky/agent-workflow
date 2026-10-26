import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, AttachmentFormat, type OfficeMeta } from '@aw/shared';
import { readDocx } from './office.docx.ts';
import { OFFICE_TEXT_FILE, type OfficeFormat, type OfficeJob, WORKBOOK_FILE } from './office.job.ts';
import { readXlsx } from './office.xlsx.ts';
import { corrupt, zipEntries } from './office.zip.ts';

async function read(format: OfficeFormat, bytes: Buffer) {
  try {
    return format === AttachmentFormat.Docx ? await readDocx(bytes) : await readXlsx(bytes, zipEntries(bytes));
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Translation: mammoth and exceljs throw plain errors on damaged parts.
    throw corrupt(`Cannot read the ${format} file: ${String(err)}`);
  }
}

export async function parseOffice({ format, source, outDir }: OfficeJob): Promise<OfficeMeta> {
  const parsed = await read(format, await readFile(source));
  await writeFile(join(outDir, OFFICE_TEXT_FILE), parsed.text);
  if ('workbook' in parsed) await writeFile(join(outDir, WORKBOOK_FILE), JSON.stringify(parsed.workbook));
  return parsed.meta;
}
