import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { APP_LICENSE, APP_SOURCE_URL, browserRectSchema, type LaunchPreferences } from '@aw/shared';
import { splashBackground, splashHtml } from '@aw/web/splash';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell, type WebPreferences } from 'electron';
import { type Backend, startBackend } from './backend.ts';
import { type BrowserPrompts, createBrowserPrompts } from './browser-prompts.ts';
import { createCompanionHost } from './companion.ts';
import { serveExports } from './export.ts';
import { readLaunchPreferences, writeLaunchPreferences } from './launch.ts';

/** In the user data directory: how the next start looks before the backend is up (28 §5.3). */
const LAUNCH_FILE = 'launch.json';

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
let backend: Backend | undefined;
let companion: ReturnType<typeof createCompanionHost> | undefined;

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
    webPreferences: {
      ...webPreferences,
      additionalArguments: [...webPreferences.additionalArguments, '--aw-main-window'],
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return { win, webPreferences };
}

/** The app itself, once the backend listens and the animation is done. */
async function openApp({ win, webPreferences }: Window, b: Backend, prompts: BrowserPrompts): Promise<void> {
  const url = process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${b.port}/`;
  serveExports(url, webPreferences);
  companion = createCompanionHost(win, url, webPreferences, () => app.quit());
  // Never navigate the privileged window away from the app; open external links in the browser.
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  // A reload starts the page over: nothing of it knows the user's tabs any more, so they close (29 §8.1).
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      b.browser.closeUserTabs();
      prompts.cancelAll();
    }
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
// The user's browser tabs (29 §8.1): the renderer is a boundary, its arguments are parsed.
ipcMain.on('aw:browser-place', (_e, tabId: unknown, rect: unknown) =>
  backend?.browser.place(String(tabId), browserRectSchema.nullable().parse(rect)),
);
for (const action of ['back', 'forward', 'reload', 'openDevTools'] as const) {
  ipcMain.on(`aw:browser-${action}`, (_e, tabId: unknown) => backend?.browser[action](String(tabId)));
}

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
  const prompts = createBrowserPrompts(() => window.win);
  // `window.splash` (28 §5): `done` once the animation ended or was skipped.
  const animated = window.win
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(launch))}`)
    .then(() => window.win.webContents.executeJavaScript('window.splash.done'));
  try {
    backend = await startBackend(isDev, apiToken, {
      window: () => window.win,
      // Only web addresses reach the system browser (29 §5.4).
      openExternal: (url) => void shell.openExternal(url),
      prompts,
    });
  } catch (e) {
    console.error('backend failed to start', e);
    await animated;
    await window.win.webContents.executeJavaScript('window.splash.fail()');
    return;
  }
  await animated;
  await window.win.webContents.executeJavaScript('window.splash.leave()');
  await openApp(window, backend, prompts);
});

async function finishQuit(running: Backend): Promise<void> {
  // 窗口已关闭；先结束本应用默认会话的请求与预连接，避免后端等待 NetworkService 的空闲 socket。
  await session.defaultSession.closeAllConnections();
  await running.stop();
  // The backend closed its own tabs as it stopped; what is left would keep Electron from exiting (B-04).
  running.browser.closeAll();
  app.quit();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => companion?.beforeQuit());
app.on('will-quit', (event) => {
  const running = backend;
  if (running === undefined) return;
  // Quit again once the backend has stopped opencode and exited (17 §3.5).
  event.preventDefault();
  backend = undefined;
  void finishQuit(running);
});
