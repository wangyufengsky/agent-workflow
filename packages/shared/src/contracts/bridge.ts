import { z } from 'zod';
import { type ErrorInfo, errorInfoSchema } from '../errors/codes.ts';

/** What the print view tells the hidden window that loaded it (23 §6.1): ready to print, or why it cannot render. */
export const printSettledSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: errorInfoSchema }),
]);
export type PrintSettled = z.infer<typeof printSettledSchema>;

/** A PDF export: where it was saved (null when the user cancelled the dialog), or why the PPT could not be printed. */
export type PdfExport = { ok: true; path: string | null } | { ok: false; error: ErrorInfo };

/** Capabilities the Electron preload exposes to the renderer as `window.aw`. */
export interface AwBridge {
  apiToken: string;
  appVersion: string;
  selectDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;
  /**
   * Prints a PPT's print view (`/ppt/:id/print`) to PDF in a hidden window and saves it where the user chooses
   * (23 §6.1).
   */
  exportPdf(deckId: string, fileName: string): Promise<PdfExport>;
  /** Saves bytes made in the renderer (a .pptx, 23 §6.2) where the user chooses; null when cancelled. */
  saveFile(fileName: string, bytes: Uint8Array): Promise<string | null>;
  /** The print view rendered every page with its fonts, or could not (the PPT is gone, the backend failed). */
  printSettled(result: PrintSettled): void;
}

/** Path of a PPT's print view, the page the hidden window prints (23 §6.1). */
export const pptPrintPath = (deckId: string) => `/ppt/${encodeURIComponent(deckId)}/print`;
