import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { APP_LICENSE, APP_SOURCE_URL, type LaunchPreferences } from '@aw/shared';
import { splashBackground, splashHtml } from '@aw/web/splash';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type WebPreferences } from 'electron';
import { type Backend, startBackend } from './backend.ts';
import { serveExports } from './export.ts';
import { readLaunchPreferences, writeLaunchPreferences } from './launch.ts';

/** In the user data directory: how the next start looks before the backend is up (28 §5.3). */
const LAUNCH_FILE = 'launch.json';

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
let backend: Backend | undefined;

type Window = { win: BrowserWindow; webPreferences: WebPreferences };

/**
 * The window comes up at once, in the remembered theme's colour, showing the opening animation while the backend
 * starts (28 §5.2): the token it will use is made here, before the backend.
 */
function createWindow(apiToken: string, launch: LaunchPreferences): Window {
  const webPreferences = {
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: [`--aw-api-token=${apiToken}`, `--aw-app-version=${app.getVersion()}`],
  };
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: splashBackground(launch),
    webPreferences,
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return { win, webPreferences };
}

/** The app itself, once the backend listens and the animation is done. */
async function openApp({ win, webPreferences }: Window, b: Backend): Promise<void> {
  const url = process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${b.port}/`;
  serveExports(url, webPreferences);
  // Never navigate the privileged window away from the app; open external links in the browser.
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  await win.loadURL(url);
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
  const launchFile = join(app.getPath('userData'), LAUNCH_FILE);
  ipcMain.on('aw:launch-preferences', (_e, preferences: unknown) => writeLaunchPreferences(launchFile, preferences));
  const launch = readLaunchPreferences(launchFile, nativeTheme.shouldUseDarkColors);
  const apiToken = randomBytes(32).toString('hex');
  const window = createWindow(apiToken, launch);
  // `window.splash` (28 §5): `done` once the animation ended or was skipped.
  const animated = window.win
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(launch))}`)
    .then(() => window.win.webContents.executeJavaScript('window.splash.done'));
  try {
    backend = await startBackend(isDev, apiToken);
  } catch (e) {
    console.error('backend failed to start', e);
    await animated;
    await window.win.webContents.executeJavaScript('window.splash.fail()');
    return;
  }
  await animated;
  await window.win.webContents.executeJavaScript('window.splash.leave()');
  await openApp(window, backend);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', (event) => {
  const running = backend;
  if (running === undefined) return;
  // Quit again once the backend has stopped opencode and exited (17 §3.5).
  event.preventDefault();
  backend = undefined;
  void running.stop().then(() => app.quit());
});
