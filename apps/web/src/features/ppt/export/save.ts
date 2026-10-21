import type { DeckDTO, ErrorInfo } from '@aw/shared';
import { deckToPptx } from './pptx.ts';

/** Characters no file system accepts in a name; the PPT's title is the file name (23 §6). */
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;
export const exportFileName = (title: string, extension: 'pdf' | 'pptx') =>
  `${title.replace(UNSAFE, ' ').trim() || 'PPT'}.${extension}`;

/**
 * Where the file went: the desktop app saves where the user chose (null when cancelled), the browser downloads; a
 * PDF whose print view could not render says why.
 */
export type Saved = { path: string } | { downloaded: true } | { failed: ErrorInfo } | null;

async function save(fileName: string, bytes: Uint8Array): Promise<Saved> {
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

export async function exportPptx(deck: DeckDTO): Promise<Saved> {
  return save(exportFileName(deck.title, 'pptx'), await deckToPptx(deck));
}

/** Desktop only: main prints the print view in a hidden window (23 §6.1). */
export async function exportPdf(deck: DeckDTO): Promise<Saved> {
  if (window.aw === undefined) throw new Error('PDF export needs the desktop app');
  const result = await window.aw.exportPdf(deck.id, exportFileName(deck.title, 'pdf'));
  if (!result.ok) return { failed: result.error };
  return result.path === null ? null : { path: result.path };
}

export const canExportPdf = () => window.aw !== undefined;
