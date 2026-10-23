import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPANION_PATH,
  COMPANION_WINDOW,
  type CompanionLabels,
  companionConfigSchema,
  companionConversationSchema,
  companionInteractiveSchema,
  companionLabelsSchema,
  companionNoticeSchema,
  companionPathSchema,
  companionPointSchema,
} from '@aw/shared';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  screen,
  Tray,
  type WebPreferences,
} from 'electron';
import { fitCompanion } from './companion-geometry.ts';

/** 一个宿主窗口管理角色窗口；关闭主界面时仍保持已认证的后端连接。 */
export function createCompanionHost(
  main: BrowserWindow,
  baseUrl: string,
  webPreferences: WebPreferences,
  quit: () => void,
) {
  let pet: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let enabled = false;
  let quitting = false;
  let active: string | null = null;
  let drag: { cursor: { x: number; y: number }; bounds: Electron.Rectangle } | undefined;
  let labels: CompanionLabels;
  const positionFile = join(app.getPath('userData'), 'companion-position.json');
  const origin = new URL(baseUrl).origin;
  const pathSchema = {
    parse(raw: unknown): string {
      const path = companionPathSchema.parse(raw);
      if (new URL(path, baseUrl).origin !== origin) throw new Error('Companion navigation must stay inside the app');
      if (new URL(path, baseUrl).pathname === COMPANION_PATH)
        throw new Error('Main window cannot become the companion');
      return path;
    },
  };
  const knownSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    (event.sender === main.webContents || event.sender === pet?.webContents) &&
    event.senderFrame === event.sender.mainFrame;
  const requireKnown = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (!knownSender(event)) throw new Error('Unrecognized companion IPC sender');
  };
  const openMain = async (path?: string) => {
    if (path !== undefined) main.webContents.send('aw:companion-navigate', pathSchema.parse(path));
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  };
  const report = (err: unknown) => console.error('companion operation failed', err);
  const fit = () => {
    if (pet === undefined) return;
    pet.setBounds(fitCompanion(pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea));
  };
  const showPet = async () => {
    if (pet !== undefined) {
      pet.showInactive();
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const position = existsSync(positionFile)
      ? companionPointSchema.parse(JSON.parse(readFileSync(positionFile, 'utf8')))
      : {
          x: area.x + area.width - COMPANION_WINDOW.width - COMPANION_WINDOW.margin,
          y: area.y + area.height - COMPANION_WINDOW.height - COMPANION_WINDOW.margin,
        };
    const bounds = { ...COMPANION_WINDOW, ...position };
    pet = new BrowserWindow({
      ...fitCompanion(bounds, screen.getDisplayMatching(bounds).workArea),
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        ...webPreferences,
        additionalArguments: [...(webPreferences.additionalArguments ?? []), '--aw-companion-window'],
      },
    });
    const window = pet;
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      if (target === new URL(COMPANION_PATH, baseUrl).href) return;
      event.preventDefault();
      const url = new URL(target);
      if (url.origin === origin) void openMain(url.pathname + url.search + url.hash).catch(report);
    });
    window.on('closed', () => {
      pet = undefined;
      drag = undefined;
    });
    window.on('show', () => updateTray());
    window.on('hide', () => updateTray());
    try {
      await window.loadURL(new URL(COMPANION_PATH, baseUrl).href);
    } catch (error) {
      if (!window.isDestroyed()) throw error;
      return;
    }
    if (!window.isDestroyed()) window.showInactive();
  };
  const updateTray = () => {
    if (tray === undefined) return;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: labels.open, click: () => void openMain().catch(report) },
        {
          label: labels.hide,
          type: 'checkbox',
          checked: pet?.isVisible() === true,
          click: () => {
            if (pet?.isVisible()) pet.hide();
            else void showPet().catch(report);
          },
        },
        { type: 'separator' },
        { label: labels.quit, click: quit },
      ]),
    );
  };
  ipcMain.handle('aw:companion-configure', async (event, raw: unknown, rawLabels: unknown) => {
    requireKnown(event);
    labels = companionLabelsSchema.parse(rawLabels);
    enabled = companionConfigSchema.parse(raw).enabled;
    if (enabled) {
      if (tray === undefined) {
        // 本应用的中性模板图标，与临时角色素材无关。
        const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build/icon.png'));
        tray = new Tray(icon.resize({ width: 18, height: 18 }));
        tray.setToolTip(labels.open);
        tray.on('click', () => void openMain().catch(report));
      }
      await showPet();
      updateTray();
    } else {
      pet?.close();
      tray?.destroy();
      tray = undefined;
      if (!main.isVisible()) await openMain();
    }
  });
  ipcMain.handle('aw:companion-open', async (event, path: unknown) => {
    requireKnown(event);
    await openMain(path === undefined ? undefined : pathSchema.parse(path));
  });
  ipcMain.on('aw:companion-interactive', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents) return;
    const interactive = companionInteractiveSchema.parse(raw);
    pet.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('aw:companion-drag-start', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents) return;
    // 起点和后续移动使用同一组屏幕坐标，避免 IPC 到达时系统光标已移动造成偏移。
    drag = { cursor: companionPointSchema.parse(raw), bounds: pet.getBounds() };
  });
  ipcMain.on('aw:companion-drag-move', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents || drag === undefined) return;
    const point = companionPointSchema.parse(raw);
    const bounds = {
      ...drag.bounds,
      x: drag.bounds.x + point.x - drag.cursor.x,
      y: drag.bounds.y + point.y - drag.cursor.y,
    };
    pet.setBounds(fitCompanion(bounds, screen.getDisplayMatching(bounds).workArea));
  });
  ipcMain.on('aw:companion-drag-end', (event) => {
    if (event.sender !== pet?.webContents) return;
    drag = undefined;
    const { x, y } = pet.getBounds();
    writeFileSync(positionFile, JSON.stringify({ x, y }));
  });
  ipcMain.handle('aw:companion-conversation-get', (event) => {
    requireKnown(event);
    return active;
  });
  ipcMain.on('aw:companion-conversation', (event, raw: unknown) => {
    requireKnown(event);
    const id = companionConversationSchema.parse(raw);
    if (active === id) return;
    active = id;
    for (const window of [main, pet]) {
      if (window !== undefined && !window.isDestroyed()) window.webContents.send('aw:companion-conversation', id);
    }
  });
  ipcMain.on('aw:companion-notice', (event, raw: unknown) => {
    if (event.sender !== main.webContents) return;
    const notice = companionNoticeSchema.parse(raw);
    pathSchema.parse(notice.path);
    if (notice.system && !main.isFocused() && Notification.isSupported()) {
      const notification = new Notification({ title: notice.title, body: notice.body });
      notification.on('click', () => void openMain(notice.path).catch(report));
      notification.show();
    }
  });
  main.on('close', (event) => {
    if (enabled && !quitting) {
      event.preventDefault();
      main.hide();
    }
  });
  screen.on('display-removed', fit);
  screen.on('display-metrics-changed', fit);
  return {
    beforeQuit: () => {
      quitting = true;
      tray?.destroy();
    },
  };
}
