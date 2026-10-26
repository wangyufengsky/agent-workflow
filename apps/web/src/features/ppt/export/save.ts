import type { DeckDTO } from '@aw/shared';
import { type Saved, saveBytes } from '../../../app/save-file.ts';
import { deckToPptx } from './pptx.ts';

/** Characters no file system accepts in a name; the PPT's title is the file name (23 §6). */
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;
export const exportFileName = (title: string, extension: 'pdf' | 'pptx') =>
  `${title.replace(UNSAFE, ' ').trim() || 'PPT'}.${extension}`;

export type { Saved };

export async function exportPptx(deck: DeckDTO): Promise<Saved> {
  return saveBytes(exportFileName(deck.title, 'pptx'), await deckToPptx(deck));
}

/** Desktop only: main prints the print view in a hidden window (23 §6.1). */
export async function exportPdf(deck: DeckDTO): Promise<Saved> {
  if (window.aw === undefined) throw new Error('PDF export needs the desktop app');
  const result = await window.aw.exportPdf(deck.id, exportFileName(deck.title, 'pdf'));
  if (!result.ok) return { failed: result.error };
  return result.path === null ? null : { path: result.path };
}

export const canExportPdf = () => window.aw !== undefined;
