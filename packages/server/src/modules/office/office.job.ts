import type { AttachmentFormat, ErrorInfo, OfficeMeta } from '@aw/shared';

/** What the model reads of a Word or Excel attachment, next to its original (39 §5). */
export const OFFICE_TEXT_FILE = 'text.md';
/** An Excel attachment's cells, for previews and the sheet tools. */
export const WORKBOOK_FILE = 'workbook.json';

export type OfficeFormat = typeof AttachmentFormat.Docx | typeof AttachmentFormat.Xlsx;
/** One parse, run in a worker thread: read `source`, write the derived files into `outDir`. */
export type OfficeJob = { format: OfficeFormat; source: string; outDir: string };
export type OfficeReply = { ok: true; meta: OfficeMeta } | { ok: false; error: ErrorInfo };
