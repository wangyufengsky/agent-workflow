import { Worker } from 'node:worker_threads';
import {
  AppError,
  AttachmentParseFailure,
  ErrorCode,
  OFFICE_WORKER_HEAP_MB,
  OFFICE_WORKER_TIMEOUT_MS,
  type OfficeMeta,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { OfficeFormat, OfficeJob, OfficeReply } from './office.job.ts';

export { detectFormat } from './office.detect.ts';
export { OFFICE_TEXT_FILE, type OfficeFormat, WORKBOOK_FILE } from './office.job.ts';

export type OfficeDeps = {
  clock: Clock;
  /** `office.worker.ts` from source, `office-worker.js` in the bundled app (config `officeWorkerFile`). */
  workerFile: string;
  /** Tests make these small to reach the limits; the app uses `OFFICE_WORKER_TIMEOUT_MS` / `_HEAP_MB`. */
  timeoutMs?: number;
  heapMb?: number;
};

const parseFailed = (reason: AttachmentParseFailure, message: string) =>
  new AppError(ErrorCode.AttachmentParseFailed, message, { reason });

/**
 * Word and Excel files to text for the model (39). Each parse runs in its own worker thread with a time and heap
 * limit (39 §5.1); the worker exits when it is done.
 */
export function createOffice({
  clock,
  workerFile,
  timeoutMs = OFFICE_WORKER_TIMEOUT_MS,
  heapMb = OFFICE_WORKER_HEAP_MB,
}: OfficeDeps) {
  return {
    /** Writes `text.md` (and an Excel file's `workbook.json`) into `outDir` and returns what the file holds. */
    parse(format: OfficeFormat, source: string, outDir: string): Promise<OfficeMeta> {
      const job: OfficeJob = { format, source, outDir };
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerFile, { workerData: job, resourceLimits: { maxOldGenerationSizeMb: heapMb } });
        let settled = false;
        const settle = (finish: () => void) => {
          if (settled) return;
          settled = true;
          cancel();
          finish();
        };
        const cancel = clock.schedule(timeoutMs, () => {
          settle(() => reject(parseFailed(AttachmentParseFailure.Timeout, `Parsing took over ${timeoutMs} ms`)));
          void worker.terminate();
        });
        worker.once('message', (reply: OfficeReply) =>
          settle(() =>
            reply.ok
              ? resolve(reply.meta)
              : reject(new AppError(reply.error.code, reply.error.message, reply.error.details)),
          ),
        );
        worker.once('error', (err: Error & { code?: string }) =>
          settle(() =>
            reject(
              err.code === 'ERR_WORKER_OUT_OF_MEMORY'
                ? parseFailed(AttachmentParseFailure.OutOfMemory, `Parsing needed over ${heapMb} MB`)
                : err,
            ),
          ),
        );
        // A worker that ends without replying or failing has a bug; say so rather than wait for the timeout.
        worker.once('exit', (code) => settle(() => reject(new Error(`Office worker exited with code ${code}`))));
      });
    },
  };
}
export type Office = ReturnType<typeof createOffice>;
