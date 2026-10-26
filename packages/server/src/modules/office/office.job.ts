import type {
  AttachmentFormat,
  CreateDocxInput,
  CreateXlsxInput,
  EditXlsxInput,
  ErrorInfo,
  OfficeLossItem,
  ReviseDocxInput,
} from '@aw/shared';
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
  | { kind: 'query_sheet'; workbook: string; query: SheetQuery }
  | { kind: 'preview_sheet'; workbook: string; sheet: string; rows: number }
  /** A file the assistant wrote, read on demand for its card (39 §8.2). */
  | { kind: 'preview_file'; file: string; sheet: string | undefined }
  /** Write a new file at `out`, which must not exist yet (39 §7.2); `styleFrom` is a Word document to take styles from. */
  | { kind: 'create_docx'; input: CreateDocxInput; out: string; styleFrom: string | undefined }
  /** A new file from the file at `source` (39 §7.2); `source` is never written. */
  | { kind: 'revise_docx'; input: ReviseDocxInput; source: string; out: string }
  | { kind: 'edit_xlsx'; input: EditXlsxInput; source: string; out: string }
  /** `workbooks` maps the attachments that `rows_from` names to their `workbook.json`. */
  | { kind: 'create_xlsx'; input: CreateXlsxInput; out: string; workbooks: Record<string, string> };
/** What a write job returns: the file's size and what it lacks of its source. */
export type OfficeWritten = { size: number; lost: OfficeLossItem[] };
export type OfficeReply = { ok: true; value: unknown } | { ok: false; error: ErrorInfo };
