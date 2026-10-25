import {
  BrowserBlockReason,
  type BrowserPolicy,
  type BrowserPortEvent,
  type BrowserPortOp,
  type BrowserPortResponse,
  type BrowserRect,
  blockReason,
  browserPortRequestSchema,
  browserShortcutSchema,
  urlAccess,
} from '@aw/shared';
import { app, type BrowserWindow, type Session, type UtilityProcess, WebContentsView } from 'electron';
import { createPartitionNetwork } from './browser-network.ts';
import type { BrowserPrompts } from './browser-prompts.ts';

type Tab = { tabId: string; view: WebContentsView; policy: BrowserPolicy; userFacing: boolean; onWindow: boolean };

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
              tab.policy,
              !tab.userFacing,
            );
      if (tab === undefined) {
        emit({ type: 'browser.unownedBlocked', url: details.url, source: details.resourceType });
      }
      if (reason !== null && tab !== undefined) {
        emit({ type: 'browser.blocked', tabId: tab.tabId, url: details.url, method: details.method, reason });
        if (tab.userFacing && details.resourceType === 'mainFrame' && reason === BrowserBlockReason.NotAllowed) {
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
    if (!tab.userFacing) {
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
    byContents.delete(tab.view.webContents.id);
    const win = window();
    // On quit the window is already gone, and its views with it.
    if (tab.onWindow && win !== null && !win.isDestroyed()) win.contentView.removeChildView(tab.view);
  }

  async function open(op: Extract<BrowserPortOp, { kind: 'open' }>): Promise<null> {
    const view = new WebContentsView({
      webPreferences: {
        partition: op.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: !op.userFacing,
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    const tab: Tab = { tabId: op.tabId, view, policy: op.policy, userFacing: op.userFacing, onWindow: false };
    configure(contents.session);
    contents.session.allowNTLMCredentialsForDomains(op.integratedAuthServers.join(','));
    await network.apply(contents.session, op.network);
    tabs.set(op.tabId, tab);
    byContents.set(contents.id, tab);

    contents.on('before-input-event', (event, input) => {
      if (!tab.userFacing || input.type !== 'keyDown' || (!input.meta && !input.control)) return;
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
      else if (tab.userFacing && isWeb(url)) openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (urlAccess(url, tab.policy) !== null) return;
      event.preventDefault();
      if (tab.userFacing && isWeb(url)) openExternal(url);
    });
    // Credentials are the user's to give, in their own tab (29 §5.4): Chromium keeps what they gave for the
    // partition, and the AI's tabs there reuse it. The AI's tabs never ask: Electron's default cancels the login (the
    // page gets the 401), and no certificate is chosen for them (the app's `select-client-certificate` above).
    contents.on('login', (event, _details, auth, callback) => {
      if (!tab.userFacing) return;
      event.preventDefault();
      void prompts
        .login({ host: auth.host, realm: auth.realm, scheme: auth.scheme, isProxy: auth.isProxy })
        .then((credentials) =>
          credentials === null ? callback() : callback(credentials.username, credentials.password),
        );
    });
    contents.on('render-process-gone', (_event, details) => {
      forget(tab);
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
      forget(tab);
      contents.close();
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
    if (!tab.userFacing) throw new Error(`Browser tab ${tabId} is not the user's`);
    return tab;
  }

  return {
    /** Carries out one request of the backend (`browser.request`). */
    async handle(op: BrowserPortOp): Promise<unknown> {
      switch (op.kind) {
        case 'open':
          return open(op);
        case 'setPolicy':
          tabOf(op.tabId).policy = op.policy;
          return null;
        case 'close': {
          const tab = tabOf(op.tabId);
          forget(tab);
          tab.view.webContents.close();
          return null;
        }
        case 'cdp':
          return tabOf(op.tabId).view.webContents.debugger.sendCommand(op.method, op.params, op.sessionId);
      }
    },

    /**
     * The renderer puts a user tab over an area of the window, or takes it off (29 §8.1). Taking it off comes after
     * the backend closed it when the user is done with it (the page's cleanup runs once the close answered): closing
     * already took it off.
     */
    place(tabId: string, rect: BrowserRect | null): void {
      if (rect === null && !tabs.has(tabId)) return;
      const tab = userTab(tabId);
      const win = window();
      if (win === null) return;
      if (rect === null) {
        if (tab.onWindow) win.contentView.removeChildView(tab.view);
        tab.onWindow = false;
        return;
      }
      if (!tab.onWindow) win.contentView.addChildView(tab.view);
      tab.onWindow = true;
      tab.view.setBounds(rect);
    },
    back: (tabId: string) => userTab(tabId).view.webContents.navigationHistory.goBack(),
    forward: (tabId: string) => userTab(tabId).view.webContents.navigationHistory.goForward(),
    reload: (tabId: string) => userTab(tabId).view.webContents.reload(),
    openDevTools: (tabId: string) => userTab(tabId).view.webContents.openDevTools({ mode: 'detach' }),

    /**
     * The page that placed the user's tabs started over (a reload): nothing of it knows their ids any more, so they
     * close, and the backend hears they are gone and lets go of what they held (a preview, 29 §8.1).
     */
    closeUserTabs(): void {
      for (const tab of [...tabs.values()]) {
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
        forget(tab);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
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
