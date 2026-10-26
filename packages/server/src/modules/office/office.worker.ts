import { readFile, writeFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '@aw/shared';
import type { OfficeJob, OfficeReply } from './office.job.ts';
import { parseOffice, previewOffice } from './office.parse.ts';
import { querySheet, readSheetPage, sheetPreview } from './office.sheets.ts';
import type { Workbook } from './office.workbook.ts';
import { sourceRows, writeDocx, writeXlsx } from './office.write.ts';

/**
 * Entry of the worker thread that runs one office job (39 §5.1), so a large workbook neither blocks the backend's
 * event loop nor grows its heap. Built as its own bundle (`office-worker.js`) next to `server.js`.
 */
if (parentPort === null) throw new Error('office.worker.ts runs only as a worker thread');
const port = parentPort;

/** `workbook.json` is written by `parseOffice` alone, so it is trusted as it was written. */
const workbookAt = async (path: string): Promise<Workbook> => JSON.parse(await readFile(path, 'utf8'));

async function run(job: OfficeJob): Promise<unknown> {
  switch (job.kind) {
    case 'parse':
      return parseOffice(job.format, job.source, job.outDir);
    case 'read_sheet':
      return readSheetPage(await workbookAt(job.workbook), job.request);
    case 'query_sheet':
      return querySheet(await workbookAt(job.workbook), job.query);
    case 'preview_sheet':
      return sheetPreview(await workbookAt(job.workbook), job.sheet, job.rows);
    case 'preview_file':
      return previewOffice(job.file, job.sheet);
    case 'create_docx':
      return written(job.out, await writeDocx(job.input));
    case 'create_xlsx': {
      const { workbooks } = job;
      const bytes = await writeXlsx(job.input.sheets, async ({ rows_from }) =>
        rows_from === undefined
          ? undefined
          : sourceRows(await workbookAt(workbooks[rows_from.attachment_id] as string), rows_from),
      );
      return written(job.out, bytes);
    }
  }
}

/** `wx`: the caller picked a name nobody has taken; a file appearing there meanwhile is not overwritten. */
async function written(out: string, bytes: Buffer): Promise<{ size: number }> {
  await writeFile(out, bytes, { flag: 'wx' });
  return { size: bytes.length };
}

let reply: OfficeReply;
try {
  reply = { ok: true, value: await run(workerData as OfficeJob) };
} catch (err) {
  // Only expected failures cross back as a reply; anything else surfaces as the worker's own error.
  if (!(err instanceof AppError)) throw err;
  reply = { ok: false, error: err.toInfo() };
}
port.postMessage(reply);
