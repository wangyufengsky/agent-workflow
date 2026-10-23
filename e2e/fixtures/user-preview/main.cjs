// 真实后端、renderer、preload 与 WebContentsView；只把 opencode 换成既有 FakeOpencode。
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, delimiter } = require('node:path');
const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron');
const { serveBrowserRequests } = require('../../../apps/desktop/src/main/browser.ts');
const { serveCredentialRequests } = require('../../../apps/desktop/src/main/credentials.ts');
const { browserRectSchema } = require('@aw/shared');

const dataDir = mkdtempSync(join(tmpdir(), 'aw-preview-electron-'));
app.setPath('userData', dataDir);
const token = 'e'.repeat(64);
let win;
let child;
let tabs;
let quitting = false;
globalThis.previewHarness = {
  token,
  ready: app.whenReady().then(async () => {
    child = utilityProcess.fork(resolve('packages/server/src/main.ts'), [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        AW_FAKE_OPENCODE: '1',
        AW_PORT: '0',
        AW_API_TOKEN: token,
        AW_DATA_DIR: dataDir,
        AW_LOG_LEVEL: 'warn',
        AW_WEB_DIR: resolve('apps/desktop/out/renderer'),
        PATH: `${resolve('e2e/fixtures/bin')}${delimiter}${process.env.PATH}`,
      },
    });
    tabs = serveBrowserRequests(child, { window: () => win ?? null, openExternal: () => {} });
    serveCredentialRequests(child);
    const port = await new Promise((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`Preview backend exited: ${code}`)));
      child.on('message', (message) => {
        if (message.type === 'ready') resolve(message.port);
      });
    });
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: true,
      webPreferences: {
        preload: resolve('apps/desktop/out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [`--aw-api-token=${token}`, '--aw-app-version=test'],
      },
    });
    ipcMain.on('aw:browser-place', (_event, tabId, rect) =>
      tabs.place(tabId, browserRectSchema.nullable().parse(rect)),
    );
    for (const action of ['back', 'forward', 'reload', 'openDevTools']) {
      ipcMain.on(`aw:browser-${action}`, (_event, tabId) => tabs[action](tabId));
    }
    const url = `http://127.0.0.1:${port}`;
    await win.loadURL(url);
    return url;
  }),
};
app.on('before-quit', (event) => {
  if (quitting || child === undefined) return;
  event.preventDefault();
  quitting = true;
  child.once('exit', () => {
    tabs.closeAll();
    app.quit();
  });
  child.postMessage({ type: 'backend.shutdown' });
});
