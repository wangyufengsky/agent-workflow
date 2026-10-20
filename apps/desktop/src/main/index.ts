import { join } from 'node:path';
import { APP_LICENSE, APP_SOURCE_URL } from '@aw/shared';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { type Backend, startBackend } from './backend.ts';

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
let backend: Backend | undefined;

function createWindow(b: Backend): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--aw-api-token=${b.apiToken}`, `--aw-app-version=${app.getVersion()}`],
    },
  });
  const url = process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${b.port}/`;
  // Never navigate the privileged window away from the app; open external links in the browser.
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadURL(url);
}

ipcMain.handle('aw:select-directory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle('aw:open-external', async (_e, url: string) => {
  if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs can be opened');
  await shell.openExternal(url);
});
ipcMain.handle('aw:reveal-in-finder', (_e, path: string) => shell.showItemInFolder(path));

app.setAboutPanelOptions({
  applicationName: 'Agent Workflow',
  applicationVersion: app.getVersion(),
  version: '',
  copyright: `${APP_LICENSE} · ${APP_SOURCE_URL}`,
});

app.whenReady().then(async () => {
  backend = await startBackend(isDev);
  createWindow(backend);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => backend?.stop());
