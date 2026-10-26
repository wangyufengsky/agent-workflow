import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPANION_PATH,
  COMPANION_WINDOW,
  type CompanionLabels,
  type CompanionPanel,
  type CompanionRect,
  companionConfigSchema,
  companionConversationSchema,
  companionInteractiveSchema,
  companionLabelsSchema,
  companionNoticeSchema,
  companionPanelSchema,
  companionPathSchema,
  companionPointSchema,
  companionPositionSchema,
  SETTING_DEFAULTS,
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
import { placeCompanion } from './companion-geometry.ts';

/**
 * Electron forwards mouse moves to a window that ignores the mouse only on macOS and Windows (`forward`). On Linux a
 * click-through companion never learns the pointer is back over it and stays unclickable, so there it always takes
 * the mouse; its window is the character and a small margin unless a panel is open (32, D192).
 */
const clickThrough = process.platform !== 'linux';

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
  let drag: { cursor: { x: number; y: number }; anchor: CompanionRect } | undefined;
  let anchor: CompanionRect | undefined;
  let panel: CompanionPanel = 'none';
  let size = SETTING_DEFAULTS['companion.size'];
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
    if (pet === undefined || anchor === undefined) return;
    const placed = placeCompanion(anchor, screen.getDisplayMatching(anchor).workArea, panel);
    anchor = placed.anchor;
    pet.setBounds(placed.bounds);
    pet.webContents.send('aw:companion-layout', placed.layout);
  };
  const showPet = async () => {
    if (pet !== undefined) {
      pet.showInactive();
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const position = existsSync(positionFile)
      ? companionPositionSchema.parse(JSON.parse(readFileSync(positionFile, 'utf8')))
      : {
          version: 2,
          x: area.x + area.width - size - COMPANION_WINDOW.margin,
          y: area.y + area.height - Math.round(size * 1.2) - COMPANION_WINDOW.margin,
        };
    // 旧文件记录 460×680 窗口左上角，迁移为角色本身的屏幕坐标。
    anchor = {
      x: position.x + (position.version === 2 ? 0 : 460 - COMPANION_WINDOW.margin - size),
      y: position.y + (position.version === 2 ? 0 : 680 - COMPANION_WINDOW.margin - Math.round(size * 1.2)),
      width: size,
      height: Math.round(size * 1.2),
    };
    panel = 'none';
    const placed = placeCompanion(anchor, screen.getDisplayMatching(anchor).workArea, panel);
    anchor = placed.anchor;
    pet = new BrowserWindow({
      ...placed.bounds,
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
    // 不把整个应用转换为 UIElementApplication；主窗口与 Dock 应保持可见。
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    if (clickThrough) window.setIgnoreMouseEvents(true, { forward: true });
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
    if (!window.isDestroyed()) {
      fit();
      window.showInactive();
    }
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
    const config = companionConfigSchema.parse(raw);
    enabled = config.enabled;
    size = config.size;
    if (anchor !== undefined) {
      anchor = {
        x: Math.round(anchor.x + (anchor.width - size) / 2),
        y: Math.round(anchor.y + (anchor.height - Math.round(size * 1.2)) / 2),
        width: size,
        height: Math.round(size * 1.2),
      };
      fit();
    }
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
  ipcMain.handle('aw:companion-panel', (event, raw: unknown) => {
    requireKnown(event);
    if (event.sender !== pet?.webContents) throw new Error('Only the companion can place its panel');
    panel = companionPanelSchema.parse(raw);
    fit();
  });
  ipcMain.on('aw:companion-interactive', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents || !clickThrough) return;
    const interactive = companionInteractiveSchema.parse(raw);
    pet.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('aw:companion-drag-start', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents || anchor === undefined) return;
    // 起点和后续移动使用同一组屏幕坐标，避免 IPC 到达时系统光标已移动造成偏移。
    drag = { cursor: companionPointSchema.parse(raw), anchor };
  });
  ipcMain.on('aw:companion-drag-move', (event, raw: unknown) => {
    if (event.sender !== pet?.webContents || drag === undefined) return;
    const point = companionPointSchema.parse(raw);
    anchor = {
      ...drag.anchor,
      x: drag.anchor.x + point.x - drag.cursor.x,
      y: drag.anchor.y + point.y - drag.cursor.y,
    };
    fit();
  });
  ipcMain.on('aw:companion-drag-end', (event) => {
    if (event.sender !== pet?.webContents || anchor === undefined) return;
    drag = undefined;
    const { x, y } = anchor;
    writeFileSync(positionFile, JSON.stringify({ version: 2, x, y }));
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
  const activate = () => void openMain().catch(report);
  app.on('activate', activate);
  main.once('closed', () => {
    app.off('activate', activate);
    screen.off('display-removed', fit);
    screen.off('display-metrics-changed', fit);
  });
  return {
    beforeQuit: () => {
      quitting = true;
      tray?.destroy();
    },
  };
}
