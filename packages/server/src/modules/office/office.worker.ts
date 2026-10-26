import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '@aw/shared';
import type { OfficeJob, OfficeReply } from './office.job.ts';
import { parseOffice } from './office.parse.ts';
import { querySheet, readSheetPage } from './office.sheets.ts';
import type { Workbook } from './office.workbook.ts';

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
  }
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
