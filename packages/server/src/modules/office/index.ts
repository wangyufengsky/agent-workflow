import { Worker } from 'node:worker_threads';
import {
  AppError,
  AttachmentParseFailure,
  ErrorCode,
  OFFICE_WORKER_HEAP_MB,
  OFFICE_WORKER_TIMEOUT_MS,
  type OfficeMeta,
  type SheetPreviewDTO,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { OfficeFormat, OfficeJob, OfficeReply } from './office.job.ts';
import type { SheetPage, SheetPageRequest, SheetQuery, SheetQueryResult } from './office.sheets.ts';

export { detectFormat } from './office.detect.ts';
export { OFFICE_TEXT_FILE, type OfficeFormat, OVERVIEW_FILE, WORKBOOK_FILE } from './office.job.ts';
export type { SheetPage, SheetPageRequest, SheetQuery, SheetQueryResult } from './office.sheets.ts';

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
 * Word and Excel files to text for the model, and the sheet tools over parsed workbooks (39). Each job runs in its
 * own worker thread with a time and heap limit (39 §5.1); the worker exits when it is done.
 */
export function createOffice({
  clock,
  workerFile,
  timeoutMs = OFFICE_WORKER_TIMEOUT_MS,
  heapMb = OFFICE_WORKER_HEAP_MB,
}: OfficeDeps) {
  function run<T>(job: OfficeJob): Promise<T> {
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
        settle(() => reject(parseFailed(AttachmentParseFailure.Timeout, `Office work took over ${timeoutMs} ms`)));
        void worker.terminate();
      });
      worker.once('message', (reply: OfficeReply) =>
        settle(() =>
          reply.ok
            ? resolve(reply.value as T)
            : reject(new AppError(reply.error.code, reply.error.message, reply.error.details)),
        ),
      );
      worker.once('error', (err: Error & { code?: string }) =>
        settle(() =>
          reject(
            err.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? parseFailed(AttachmentParseFailure.OutOfMemory, `Office work needed over ${heapMb} MB`)
              : err,
          ),
        ),
      );
      // A worker that ends without replying or failing has a bug; say so rather than wait for the timeout.
      worker.once('exit', (code) => settle(() => reject(new Error(`Office worker exited with code ${code}`))));
    });
  }

  return {
    /** Writes `text.md` (and an Excel file's `workbook.json` and `overview.md`) into `outDir`. */
    parse: (format: OfficeFormat, source: string, outDir: string) =>
      run<OfficeMeta>({ kind: 'parse', format, source, outDir }),
    /** A `read_sheet` page of the parsed workbook at `workbook` (39 §6.2). */
    readSheet: (workbook: string, request: SheetPageRequest) =>
      run<SheetPage>({ kind: 'read_sheet', workbook, request }),
    /** A `query_sheet` result over the parsed workbook at `workbook` (39 §6.2). */
    querySheet: (workbook: string, query: SheetQuery) =>
      run<SheetQueryResult>({ kind: 'query_sheet', workbook, query }),
    /** The first `rows` rows of a sheet, for the attachment preview (39 §8.1). */
    previewSheet: (workbook: string, sheet: string, rows: number) =>
      run<SheetPreviewDTO>({ kind: 'preview_sheet', workbook, sheet, rows }),
  };
}
export type Office = ReturnType<typeof createOffice>;
