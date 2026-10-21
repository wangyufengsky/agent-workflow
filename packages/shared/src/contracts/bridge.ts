/** Capabilities the Electron preload exposes to the renderer as `window.aw`. */
export interface AwBridge {
  apiToken: string;
  appVersion: string;
  selectDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;
  /**
   * Prints a PPT's print view (`/ppt/:id/print`) to PDF in a hidden window and saves it where the user chooses
   * (23 §6.1); resolves with the saved path, or null when the user cancelled.
   */
  exportPdf(deckId: string, fileName: string): Promise<string | null>;
  /** Saves bytes made in the renderer (a .pptx, 23 §6.2) where the user chooses; null when cancelled. */
  saveFile(fileName: string, bytes: Uint8Array): Promise<string | null>;
  /** The print view tells the hidden window it finished rendering (fonts loaded, every page laid out). */
  printReady(): void;
}

/** Path of a PPT's print view, the page the hidden window prints (23 §6.1). */
export const pptPrintPath = (deckId: string) => `/ppt/${encodeURIComponent(deckId)}/print`;
