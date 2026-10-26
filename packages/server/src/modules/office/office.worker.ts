import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '@aw/shared';
import type { OfficeJob, OfficeReply } from './office.job.ts';
import { parseOffice } from './office.parse.ts';

/**
 * Entry of the worker thread that parses one Word or Excel file (39 §5.1), so a large workbook neither blocks the
 * backend's event loop nor grows its heap. Built as its own bundle (`office-worker.js`) next to `server.js`.
 */
if (parentPort === null) throw new Error('office.worker.ts runs only as a worker thread');
const port = parentPort;

let reply: OfficeReply;
try {
  reply = { ok: true, meta: await parseOffice(workerData as OfficeJob) };
} catch (err) {
  // Only expected failures cross back as a reply; anything else surfaces as the worker's own error.
  if (!(err instanceof AppError)) throw err;
  reply = { ok: false, error: err.toInfo() };
}
port.postMessage(reply);
