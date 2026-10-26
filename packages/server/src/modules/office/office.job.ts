import type { AttachmentFormat, ErrorInfo } from '@aw/shared';
import type { SheetPageRequest, SheetQuery } from './office.sheets.ts';

/** What the model reads of a Word or Excel attachment, next to its original (39 §5). */
export const OFFICE_TEXT_FILE = 'text.md';
/** An Excel attachment's cells, for previews and the sheet tools. */
export const WORKBOOK_FILE = 'workbook.json';
/** What the prompt shows of an Excel attachment (39 §6.1). */
export const OVERVIEW_FILE = 'overview.md';

export type OfficeFormat = typeof AttachmentFormat.Docx | typeof AttachmentFormat.Xlsx;

/**
 * Work for the office worker thread (39 §5.1): parse a file into its derived files next to it, or read a page of or
 * query a sheet of a parsed workbook, so large workbooks never load on the backend's own thread.
 */
export type OfficeJob =
  | { kind: 'parse'; format: OfficeFormat; source: string; outDir: string }
  | { kind: 'read_sheet'; workbook: string; request: SheetPageRequest }
  | { kind: 'query_sheet'; workbook: string; query: SheetQuery };
export type OfficeReply = { ok: true; value: unknown } | { ok: false; error: ErrorInfo };
