import {
  BrowserBlockReason,
  type BrowserPolicy,
  type BrowserPortEvent,
  type BrowserPortOp,
  type BrowserPortResponse,
  type BrowserRect,
  type BrowserWatchZoom,
  blockReason,
  browserPortRequestSchema,
  browserShortcutSchema,
  urlAccess,
} from '@aw/shared';
import { app, type BrowserWindow, type Session, screen, type UtilityProcess, WebContentsView } from 'electron';
import { createPartitionNetwork } from './browser-network.ts';
import type { BrowserPrompts } from './browser-prompts.ts';
import { createBrowserWatch, isWatchMetrics } from './browser-watch.ts';

type Tab = {
  tabId: string;
  view: WebContentsView;
  contentsId: number;
  partition: Session;
  policy: BrowserPolicy;
  userFacing: boolean;
  caseSession: boolean;
  onWindow: boolean;
  watch?: ReturnType<typeof createBrowserWatch>;
};

export type BrowserTabsDeps = {
  /** The window user-facing tabs are placed on. */
  window: () => BrowserWindow | null;
  emit: (event: BrowserPortEvent) => void;
  /** Where a user-facing tab sends addresses the policy denies (29 §5.4). */
  openExternal: (url: string) => void;
  /** Asks the user what a website asks their own tab: a login or a client certificate (29 §5.4). */
  prompts: Pick<BrowserPrompts, 'login' | 'certificate'>;
};

const WEB_SCHEMES = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];
const isWeb = (url: string) => /^https?:\/\//i.test(url);

/**
 * Browser tabs in Electron main (29 §5.1): views, the CDP relay and request cancelling by the policy the backend
 * gives each tab. Mechanism only: what to open, when a page has settled and what a click hit are the backend's.
 */
export function createBrowserTabs({ window, emit, openExternal, prompts }: BrowserTabsDeps) {
  const tabs = new Map<string, Tab>();
  const byContents = new Map<number, Tab>();
  const configured = new Set<Session>();
  const network = createPartitionNetwork();
  let watchShield: WebContentsView | undefined;
  let shieldedTab: Tab | undefined;
  let drag: { x: number; y: number } | undefined;

  /** 观看时透明视图接收窗口输入，CDP 操作仍直接发给下方测试页签。 */
  function unshield(tab: Tab): void {
    if (shieldedTab !== tab || watchShield === undefined) return;
    const win = window();
    if (win !== null && !win.isDestroyed()) win.contentView.removeChildView(watchShield);
    shieldedTab = undefined;
    drag = undefined;
  }

  function shield(tab: Tab): void {
    const win = window();
    if (win === null || !tab.onWindow || !tab.caseSession || hasUserControl(tab)) return;
    if (watchShield === undefined) {
      watchShield = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
      watchShield.setBackgroundColor('#00000000');
      // 未加载页面的透明视图挡住鼠标，但没有接收拖动事件的渲染器。
      void watchShield.webContents
        .loadURL('about:blank')
        .catch((err: unknown) => console.error('Browser watch input surface failed to load', err));
      watchShield.webContents.on('before-mouse-event', (event, input) => {
        const watch = shieldedTab?.watch;
        if (watch === undefined) return;
        const { x, y } = input;
        if (input.type === 'mouseDown' && input.button === 'left') {
          drag = { x, y };
          watchShield?.webContents.focus();
        } else if (input.type === 'mouseMove' && drag !== undefined) {
          watch.pan(x - drag.x, y - drag.y);
          drag = { x, y };
        } else if (input.type === 'mouseUp' || input.type === 'mouseLeave') {
          drag = undefined;
        }
        event.preventDefault();
      });
      watchShield.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        if (!input.meta && !input.control) {
          const watch = shieldedTab?.watch;
          const deltas: Record<string, readonly [number, number]> = {
            ArrowLeft: [48, 0],
            ArrowRight: [-48, 0],
            ArrowUp: [0, 48],
            ArrowDown: [0, -48],
          };
          const delta = deltas[input.key];
          if (watch !== undefined && delta !== undefined) {
            event.preventDefault();
            watch.pan(...delta);
          }
          return;
        }
        const shortcut = browserShortcutSchema.safeParse(input.key.toLowerCase());
        if (!shortcut.success) return;
        event.preventDefault();
        const current = window();
        current?.webContents.focus();
        current?.webContents.send('aw:browser-shortcut', shortcut.data);
      });
    }
    if (shieldedTab !== undefined && shieldedTab !== tab) unshield(shieldedTab);
    if (shieldedTab !== tab) win.contentView.addChildView(watchShield);
    watchShield.setBounds(tab.view.getBounds());
    shieldedTab = tab;
  }

  function tabOf(tabId: string): Tab {
    const tab = tabs.get(tabId);
    if (tab === undefined) throw new Error(`No browser tab ${tabId}`);
    return tab;
  }

  /** One request listener per session (Electron allows no more), deciding by the tab the request comes from. */
  function configure(ses: Session): void {
    if (configured.has(ses)) return;
    configured.add(ses);
    ses.webRequest.onBeforeRequest({ urls: WEB_SCHEMES }, (details, callback) => {
      const tab = details.webContentsId === undefined ? undefined : byContents.get(details.webContentsId);
      // Worker 请求若无法归属单个标签页，不继承同分区中任一用户页或 AI 页的权限。
      const reason =
        tab === undefined
          ? BrowserBlockReason.NotAllowed
          : blockReason(
              { url: details.url, method: details.method, isWebSocket: details.resourceType === 'webSocket' },
              requestPolicy(tab),
              !tab.userFacing,
            );
      if (tab === undefined) {
        emit({ type: 'browser.unownedBlocked', url: details.url, source: details.resourceType });
      }
      if (reason !== null && tab !== undefined) {
        emit({ type: 'browser.blocked', tabId: tab.tabId, url: details.url, method: details.method, reason });
        if (
          tab.userFacing &&
          tab.policy.automation === undefined &&
          details.resourceType === 'mainFrame' &&
          reason === BrowserBlockReason.NotAllowed
        ) {
          openExternal(details.url);
        }
      }
      callback({ cancel: reason !== null });
    });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
  }

  /**
   * A website (`host:port`, not a URL) asks a tab for a client certificate (29 §5.4). Electron's default would take
   * the first one of the store for any tab; the user chooses in their own tab (Chromium remembers the choice for the
   * partition). The AI's tabs give none, and do not answer either: Chromium would remember "no certificate" for the
   * whole partition, and the user could not choose one in their login tab until the app restarts. Stopping the load
   * drops the request unanswered. On the app (not the tab's contents): only there can the callback give none.
   */
  app.on('select-client-certificate', (event, contents, host, certificates, callback) => {
    const tab = contents === null ? undefined : byContents.get(contents.id);
    // The app's own windows load the app itself, which asks for none.
    if (tab === undefined) return;
    event.preventDefault();
    if (!hasUserControl(tab)) {
      emit({ type: 'browser.certificateRefused', tabId: tab.tabId, host });
      tab.view.webContents.stop();
      return;
    }
    void prompts
      .certificate({
        host,
        certificates: certificates.map((c) => ({
          fingerprint: c.fingerprint,
          subject: c.subjectName,
          issuer: c.issuerName,
          validExpiry: c.validExpiry,
        })),
      })
      .then((fingerprint) => callback(certificates.find((c) => c.fingerprint === fingerprint)));
  });

  // The app's own windows load the app itself, whose certificate errors stand (Electron refuses them).
  app.on('certificate-error', (event, contents, url, error, certificate, callback) => {
    if (!byContents.has(contents.id)) return;
    if (!network.vouches(contents.session, error, certificate, new URL(url).hostname)) return;
    event.preventDefault();
    callback(true);
  });

  function forget(tab: Tab): void {
    tabs.delete(tab.tabId);
    byContents.delete(tab.contentsId);
    hide(tab);
  }

  function hide(tab: Tab): void {
    unshield(tab);
    const win = window();
    if (tab.onWindow && win !== null && !win.isDestroyed()) win.contentView.removeChildView(tab.view);
    tab.onWindow = false;
    tab.watch?.refresh();
  }

  function requestPolicy(tab: Tab): BrowserPolicy {
    const scope = tab.policy.automation;
    // 手动写入权限随原生视图可见，离开测试页签时仍按用例规则检查请求。
    return !tab.onWindow && scope?.manual === true
      ? { ...tab.policy, automation: { ...scope, manual: false } }
      : tab.policy;
  }

  function hasUserControl(tab: Tab): boolean {
    return tab.userFacing || (tab.caseSession && tab.policy.automation?.manual === true);
  }

  async function close(tab: Tab): Promise<void> {
    const contents = tab.view.webContents;
    const partition = tab.partition;
    forget(tab);
    if (!contents.isDestroyed()) contents.close();
    if (tab.caseSession) {
      await partition.closeAllConnections();
      await Promise.all([partition.clearStorageData(), partition.clearCache(), partition.clearAuthCache()]);
      configured.delete(partition);
    }
  }

  function closeAfterLoss(tab: Tab): void {
    void close(tab).catch((err: unknown) => console.error('Browser session cleanup failed', err));
  }

  async function open(op: Extract<BrowserPortOp, { kind: 'open' }>): Promise<null> {
    const view = new WebContentsView({
      webPreferences: {
        partition: op.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: !op.userFacing && op.caseSession !== true,
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    const tab: Tab = {
      tabId: op.tabId,
      view,
      contentsId: contents.id,
      partition: contents.session,
      policy: op.policy,
      userFacing: op.userFacing,
      caseSession: op.caseSession === true,
      onWindow: false,
    };
    if (tab.caseSession && op.viewport !== null) {
      tab.watch = createBrowserWatch(contents, { ...op.viewport, deviceScaleFactor: 1 }, () => {
        const win = window();
        if (win === null || !tab.onWindow || hasUserControl(tab)) return null;
        return { bounds: tab.view.getBounds(), displayScale: screen.getDisplayMatching(win.getBounds()).scaleFactor };
      });
    }
    configure(contents.session);
    contents.session.allowNTLMCredentialsForDomains(op.integratedAuthServers.join(','));
    await network.apply(contents.session, op.network);
    tabs.set(op.tabId, tab);
    byContents.set(contents.id, tab);

    contents.on('before-input-event', (event, input) => {
      if (!hasUserControl(tab) || input.type !== 'keyDown' || (!input.meta && !input.control)) return;
      const shortcut = browserShortcutSchema.safeParse(input.key.toLowerCase());
      if (!shortcut.success) return;
      event.preventDefault();
      const win = window();
      if (win !== null) {
        win.webContents.focus();
        win.webContents.send('aw:browser-shortcut', shortcut.data);
      }
    });

    // `window.open` of an allowed address stays in this tab: one tab per session (29 §5.3).
    contents.setWindowOpenHandler(({ url }) => {
      if (urlAccess(url, tab.policy) !== null) void contents.loadURL(url);
      else if (tab.userFacing && tab.policy.automation === undefined && isWeb(url)) openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (urlAccess(url, tab.policy) !== null) return;
      event.preventDefault();
      if (tab.userFacing && tab.policy.automation === undefined && isWeb(url)) openExternal(url);
    });
    // Credentials are the user's to give, in their own tab (29 §5.4): Chromium keeps what they gave for the
    // partition, and the AI's tabs there reuse it. The AI's tabs never ask: Electron's default cancels the login (the
    // page gets the 401), and no certificate is chosen for them (the app's `select-client-certificate` above).
    contents.on('login', (event, _details, auth, callback) => {
      if (!hasUserControl(tab)) return;
      event.preventDefault();
      void prompts
        .login({ host: auth.host, realm: auth.realm, scheme: auth.scheme, isProxy: auth.isProxy })
        .then((credentials) =>
          credentials === null ? callback() : callback(credentials.username, credentials.password),
        );
    });
    contents.on('render-process-gone', (_event, details) => {
      if (!tabs.has(tab.tabId)) return;
      closeAfterLoss(tab);
      emit({ type: 'browser.gone', tabId: tab.tabId, reason: details.reason });
    });

    // A view that never loaded a page has no renderer: Page.enable would never answer (29 §12 V1).
    await contents.loadURL('about:blank');
    contents.debugger.attach('1.3');
    contents.debugger.on('message', (_event, method, params, sessionId) => {
      emit({ type: 'browser.cdpEvent', tabId: tab.tabId, method, params, ...(sessionId ? { sessionId } : {}) });
    });
    contents.debugger.on('detach', (_event, reason) => {
      if (!tabs.has(tab.tabId)) return;
      closeAfterLoss(tab);
      emit({ type: 'browser.gone', tabId: tab.tabId, reason: `debugger detached: ${reason}` });
    });
    if (op.viewport !== null) {
      // An offscreen view outside a window is 0×0 until told otherwise (29 §12 V1).
      await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: op.viewport.width,
        height: op.viewport.height,
        deviceScaleFactor: 1,
        mobile: op.viewport.mobile,
      });
    }
    return null;
  }

  function userTab(tabId: string): Tab {
    const tab = tabOf(tabId);
    if (!hasUserControl(tab)) throw new Error(`Browser tab ${tabId} is not the user's`);
    return tab;
  }

  return {
    /** Carries out one request of the backend (`browser.request`). */
    async handle(op: BrowserPortOp): Promise<unknown> {
      switch (op.kind) {
        case 'open':
          return open(op);
        case 'setPolicy': {
          const tab = tabOf(op.tabId);
          const wasManual = tab.caseSession && hasUserControl(tab);
          tab.policy = op.policy;
          if (tab.caseSession) {
            if (hasUserControl(tab)) {
              await tab.watch?.sync();
              unshield(tab);
            } else {
              if (wasManual) window()?.webContents.focus();
              shield(tab);
              tab.watch?.refresh();
            }
          }
          return null;
        }
        case 'close': {
          const tab = tabs.get(op.tabId);
          if (tab !== undefined) await close(tab);
          return null;
        }
        case 'cdp': {
          const tab = tabOf(op.tabId);
          const run = () => tab.view.webContents.debugger.sendCommand(op.method, op.params, op.sessionId);
          if (tab.watch !== undefined && op.sessionId === undefined) {
            if (op.method === 'Emulation.setDeviceMetricsOverride' && isWatchMetrics(op.params))
              return tab.watch.changeMetrics(op.params);
            if (op.method === 'Page.captureScreenshot') return tab.watch.capture(run);
          }
          return run();
        }
      }
    },

    /**
     * The renderer puts a user tab over an area of the window, or takes it off (29 §8.1). Taking it off comes after
     * the backend closed it when the user is done with it (the page's cleanup runs once the close answered): closing
     * already took it off.
     */
    place(tabId: string, rect: BrowserRect | null): void {
      const tab = tabs.get(tabId);
      if (tab === undefined || (rect !== null && !tab.caseSession && !hasUserControl(tab))) return;
      const win = window();
      if (win === null) return;
      if (rect === null) {
        hide(tab);
        return;
      }
      if (!tab.onWindow) win.contentView.addChildView(tab.view);
      tab.onWindow = true;
      tab.view.setBounds(rect);
      shield(tab);
      tab.watch?.refresh();
    },
    setWatchZoom(tabId: string, zoom: BrowserWatchZoom): void {
      const tab = tabs.get(tabId);
      if (tab?.onWindow && !hasUserControl(tab)) tab.watch?.setZoom(zoom);
    },
    back: (tabId: string) => userTab(tabId).view.webContents.navigationHistory.goBack(),
    forward: (tabId: string) => userTab(tabId).view.webContents.navigationHistory.goForward(),
    reload(tabId: string): void {
      const tab = userTab(tabId);
      const contents = tab.view.webContents;
      if (!tab.caseSession) {
        contents.reload();
        return;
      }
      // 验证页可能来自 POST，不让重新加载重发该请求。
      const url = contents.getURL();
      if (urlAccess(url, tab.policy) !== null) {
        void contents.loadURL(url).catch((err: unknown) => console.error('Browser case page reload failed', err));
      }
    },
    openDevTools: (tabId: string) => {
      const tab = userTab(tabId);
      if (!tab.caseSession) tab.view.webContents.openDevTools({ mode: 'detach' });
    },

    /**
     * The page that placed the user's tabs started over (a reload): nothing of it knows their ids any more, so they
     * close, and the backend hears they are gone and lets go of what they held (a preview, 29 §8.1).
     */
    closeUserTabs(): void {
      for (const tab of [...tabs.values()]) {
        if (tab.caseSession) {
          hide(tab);
          continue;
        }
        if (!tab.userFacing) continue;
        forget(tab);
        tab.view.webContents.close();
        emit({ type: 'browser.gone', tabId: tab.tabId, reason: 'the app page started over' });
      }
    },

    /**
     * After the backend stopped on quit: what it left open, since an open offscreen view keeps Electron from exiting
     * even after `quit` (found in B-04).
     */
    closeAll(): void {
      for (const tab of [...tabs.values()]) {
        if (tab.caseSession || !tab.view.webContents.isDestroyed()) closeAfterLoss(tab);
        else forget(tab);
      }
      if (watchShield !== undefined && !watchShield.webContents.isDestroyed()) watchShield.webContents.close();
      watchShield = undefined;
    },
  };
}

export type BrowserTabs = ReturnType<typeof createBrowserTabs>;

/** Browser tabs serving the backend's `browser.request` messages; their events go back to it unasked. */
export function serveBrowserRequests(child: UtilityProcess, deps: Omit<BrowserTabsDeps, 'emit'>): BrowserTabs {
  const tabs = createBrowserTabs({ ...deps, emit: (event) => child.postMessage(event) });
  child.on('message', (message: unknown) => {
    const parsed = browserPortRequestSchema.safeParse(message);
    if (!parsed.success) return;
    const { id, op } = parsed.data;
    tabs.handle(op).then(
      (result): void => {
        const response: BrowserPortResponse = { type: 'browser.response', id, ok: true, result: result ?? null };
        child.postMessage(response);
      },
      (err: unknown): void => {
        // Translate: the backend turns this into an error of the tool or operation that asked.
        const response: BrowserPortResponse = {
          type: 'browser.response',
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        child.postMessage(response);
      },
    );
  });
  return tabs;
}
