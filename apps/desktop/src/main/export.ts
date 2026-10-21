import { writeFile } from 'node:fs/promises';
import { pptPrintPath } from '@aw/shared';
import { BrowserWindow, dialog, ipcMain, type WebPreferences } from 'electron';

/** 16:9 at 1280×720 CSS pixels, in inches: the print view's page size (23 §6.1). */
const SLIDE_PAGE_INCHES = { width: 1280 / 96, height: 720 / 96 };

async function saveAs(parent: BrowserWindow | null, fileName: string, data: Uint8Array): Promise<string | null> {
  const options = { defaultPath: fileName };
  const result = parent === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(parent, options);
  if (result.canceled || result.filePath === undefined) return null;
  await writeFile(result.filePath, data);
  return result.filePath;
}

/**
 * PPT export (23 §6): the print view is loaded in a hidden window of the same origin and preload, which signals once
 * it has rendered; Chromium prints it to a vector PDF page by page.
 */
export function serveExports(appUrl: string, webPreferences: WebPreferences): void {
  ipcMain.handle('aw:export-pdf', async (event, deckId: string, fileName: string) => {
    const hidden = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences });
    try {
      const ready = new Promise<void>((resolve) => {
        const onReady = (e: Electron.IpcMainEvent) => {
          if (e.sender !== hidden.webContents) return;
          ipcMain.off('aw:print-ready', onReady);
          resolve();
        };
        ipcMain.on('aw:print-ready', onReady);
      });
      await hidden.loadURL(new URL(pptPrintPath(deckId), appUrl).href);
      await ready;
      const pdf = await hidden.webContents.printToPDF({
        pageSize: SLIDE_PAGE_INCHES,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        preferCSSPageSize: true,
      });
      return await saveAs(BrowserWindow.fromWebContents(event.sender), fileName, pdf);
    } finally {
      hidden.destroy();
    }
  });
  ipcMain.handle('aw:save-file', (event, fileName: string, bytes: Uint8Array) =>
    saveAs(BrowserWindow.fromWebContents(event.sender), fileName, bytes),
  );
}
