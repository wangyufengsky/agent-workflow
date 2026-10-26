import type { ErrorInfo } from '@aw/shared';

/**
 * Where a saved file went: the desktop app saves where the user chose (null when cancelled), the browser downloads; a
 * PDF whose print view could not render says why.
 */
export type Saved = { path: string } | { downloaded: true } | { failed: ErrorInfo } | null;

/** Bytes made in the app saved as a file (23 §6, 39 §8.2): a save dialog in the desktop app, a download in a browser. */
export async function saveBytes(fileName: string, bytes: Uint8Array): Promise<Saved> {
  if (window.aw !== undefined) {
    const path = await window.aw.saveFile(fileName, bytes);
    return path === null ? null : { path };
  }
  // Development in a browser (and E2E): a download.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}
