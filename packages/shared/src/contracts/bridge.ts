import { z } from 'zod';
import { themeIdSchema } from '../enums/ui.ts';
import { type ErrorInfo, errorInfoSchema } from '../errors/codes.ts';
import type { CompanionBridge } from './companion.ts';

/**
 * How the next start looks before the backend (and so the settings) is up (28 §5.3): the theme the renderer applied
 * and whether to play the opening animation. Main keeps it in `<userData>/launch.json`.
 */
export const launchPreferencesSchema = z.object({ theme: themeIdSchema, intro: z.boolean() });
export type LaunchPreferences = z.infer<typeof launchPreferencesSchema>;

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
  companion: CompanionBridge;
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
  /** Remembers the applied theme and the opening-animation setting for the next start (28 §5.3). */
  setLaunchPreferences(preferences: LaunchPreferences): void;
  /** The user's own browser tabs (29 §8.1), opened by the backend; only user-facing tabs answer. */
  browser: {
    /** Puts the tab over this area of the window (CSS pixels), or takes it off the window with null. */
    place(tabId: string, rect: BrowserRect | null): void;
    back(tabId: string): void;
    forward(tabId: string): void;
    reload(tabId: string): void;
    openDevTools(tabId: string): void;
  };
}

/** An area of the window, as the renderer measures it; main parses it like any input from the renderer. */
export const browserRectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});
export type BrowserRect = z.infer<typeof browserRectSchema>;

/** Path of a PPT's print view, the page the hidden window prints (23 §6.1). */
export const pptPrintPath = (deckId: string) => `/ppt/${encodeURIComponent(deckId)}/print`;
