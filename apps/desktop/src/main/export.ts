import { writeFile } from 'node:fs/promises';
import { ErrorCode, type PdfExport, type PrintSettled, pptPrintPath, printSettledSchema } from '@aw/shared';
import { BrowserWindow, dialog, type IpcMainEvent, ipcMain, type WebPreferences } from 'electron';

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
 * Settles once the print view in `hidden` reports, or its renderer is gone (then it can never report). `stop`
 * removes the listeners; the caller runs it in every case.
 */
function printViewSettled(hidden: BrowserWindow): { settled: Promise<PrintSettled>; stop(): void } {
  const { promise: settled, resolve } = Promise.withResolvers<PrintSettled>();
  const onSettled = (event: IpcMainEvent, result: unknown) => {
    // The renderer is a boundary: its message is parsed like any input.
    if (event.sender === hidden.webContents) resolve(printSettledSchema.parse(result));
  };
  const onGone = (_event: unknown, details: Electron.RenderProcessGoneDetails) =>
    resolve({
      ok: false,
      error: { code: ErrorCode.InternalError, message: `The print view stopped: ${details.reason}` },
    });
  ipcMain.on('aw:print-settled', onSettled);
  hidden.webContents.on('render-process-gone', onGone);
  return {
    settled,
    stop: () => {
      ipcMain.off('aw:print-settled', onSettled);
      hidden.webContents.off('render-process-gone', onGone);
    },
  };
}

/**
 * PPT export (23 §6): the print view is loaded in a hidden window of the same origin and preload; it reports whether
 * it rendered, and Chromium prints it to a vector PDF page by page.
 */
export function serveExports(appUrl: string, webPreferences: WebPreferences): void {
  ipcMain.handle('aw:export-pdf', async (event, deckId: string, fileName: string): Promise<PdfExport> => {
    const hidden = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences });
    const view = printViewSettled(hidden);
    try {
      await hidden.loadURL(new URL(pptPrintPath(deckId), appUrl).href);
      const result = await view.settled;
      if (!result.ok) return result;
      const pdf = await hidden.webContents.printToPDF({
        pageSize: SLIDE_PAGE_INCHES,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        preferCSSPageSize: true,
      });
      return { ok: true, path: await saveAs(BrowserWindow.fromWebContents(event.sender), fileName, pdf) };
    } finally {
      view.stop();
      hidden.destroy();
    }
  });
  ipcMain.handle('aw:save-file', (event, fileName: string, bytes: Uint8Array) =>
    saveAs(BrowserWindow.fromWebContents(event.sender), fileName, bytes),
  );
}
