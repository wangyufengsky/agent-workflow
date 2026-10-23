import { type BrowserPolicy, type BrowserPortEvent, type BrowserPortOp, blockReason } from '@aw/shared';
import { type Browser, type BrowserContext, type CDPSession, chromium, type Page } from 'playwright-core';
import { BROWSER_CDP_EVENTS, type BrowserHost } from './browser.host.ts';

type Tab = { page: Page; session: CDPSession; policy: BrowserPolicy; userFacing: boolean };

/**
 * Development and tests only (plain Node has no Electron): tabs in a Chromium of playwright-core, cancelling requests
 * by the same `blockReason` as Electron main. `window.open` stays in the tab as there. The marker below lets
 * scripts/check-prod-bundle.mjs prove this file is not in the production bundle.
 */
export const DEV_CHROMIUM_HOST_MARKER = 'aw-dev-chromium-host';

export function createChromiumHost(): BrowserHost & { close(): Promise<void> } {
  // Launched with the first tab: a development backend that never browses starts no browser.
  let launched: Promise<Browser> | undefined;
  const browser = () => {
    launched ??= launch();
    return launched;
  };
  const contexts = new Map<string, BrowserContext>();
  const tabs = new Map<string, Tab>();
  const listeners = new Set<(event: BrowserPortEvent) => void>();
  const emit = (event: BrowserPortEvent) => {
    for (const listener of listeners) listener(event);
  };

  async function launch(): Promise<Browser> {
    const instance = await chromium.launch({ headless: true });
    try {
      const session = await instance.newBrowserCDPSession();
      // SharedWorker 可由同分区多个标签页共用，不能继承其中某个页面的权限。
      // 先在执行前暂停再关闭；仅给页面装 Fetch 拦截器看不到 Worker 内部发起的请求。
      session.on('Target.attachedToTarget', async ({ targetInfo }) => {
        const event = { type: 'browser.unownedBlocked' as const, url: targetInfo.url, source: targetInfo.type };
        try {
          await session.send('Target.closeTarget', { targetId: targetInfo.targetId });
          emit(event);
        } catch (err) {
          // 关闭浏览器与目标清理可能相遇；目标仍暂停，不恢复执行，显式记录清理失败。
          emit({ ...event, cleanupError: err instanceof Error ? err.message : String(err) });
        }
      });
      await session.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: 'shared_worker' }, { exclude: true }],
      });
      return instance;
    } catch (err) {
      await instance.close();
      throw err;
    }
  }

  function tabOf(tabId: string): Tab {
    const tab = tabs.get(tabId);
    if (tab === undefined) throw new Error(`No browser tab ${tabId}`);
    return tab;
  }

  async function open(op: Extract<BrowserPortOp, { kind: 'open' }>): Promise<null> {
    const context =
      contexts.get(op.partition) ??
      (await (await browser()).newContext({ acceptDownloads: false, serviceWorkers: 'block' }));
    contexts.set(op.partition, context);
    const page = await context.newPage();
    const tab: Tab = { page, session: await context.newCDPSession(page), policy: op.policy, userFacing: op.userFacing };
    tabs.set(op.tabId, tab);
    const blocked = (url: string, method: string, isWebSocket: boolean) => {
      const reason = blockReason({ url, method, isWebSocket }, tab.policy, !tab.userFacing);
      if (reason !== null) emit({ type: 'browser.blocked', tabId: op.tabId, url, method, reason });
      return reason;
    };
    // Playwright 的 route 只交付重定向链的首次请求；CDP 在每一跳发送前检查，和 Electron 一致。
    tab.session.on('Fetch.requestPaused', async ({ requestId, request }) => {
      if (blocked(request.url, request.method, false) === null) {
        await tab.session.send('Fetch.continueRequest', { requestId });
      } else {
        await tab.session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      }
    });
    await tab.session.send('Fetch.enable', {
      patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }],
    });
    await page.routeWebSocket(/.*/, (ws) => {
      if (blocked(ws.url(), 'GET', true) === null) ws.connectToServer();
      else void ws.close();
    });
    // Playwright dismisses dialogs nobody listens to; the browser module answers them over CDP, as with Electron.
    page.on('dialog', () => {});
    // Runs in the page (the server has no DOM types): an opened window loads in this tab instead.
    await page.addInitScript({
      content: 'window.open = (url) => { if (url !== undefined) location.href = String(url); return null; };',
    });
    for (const method of BROWSER_CDP_EVENTS) {
      tab.session.on(method, (params: unknown) => emit({ type: 'browser.cdpEvent', tabId: op.tabId, method, params }));
    }
    await page.goto('about:blank');
    if (op.viewport !== null) {
      await tab.session.send('Emulation.setDeviceMetricsOverride', {
        width: op.viewport.width,
        height: op.viewport.height,
        deviceScaleFactor: 1,
        mobile: op.viewport.mobile,
      });
    }
    return null;
  }

  return {
    async request(op) {
      switch (op.kind) {
        case 'open':
          return open(op);
        case 'setPolicy':
          tabOf(op.tabId).policy = op.policy;
          return null;
        case 'close':
          await tabOf(op.tabId).page.close();
          tabs.delete(op.tabId);
          return null;
        case 'cdp':
          // The port carries CDP method names as strings, as Electron's debugger takes them.
          return tabOf(op.tabId).session.send(op.method as Parameters<CDPSession['send']>[0], op.params);
      }
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      if (launched !== undefined) await (await launched).close();
    },
  };
}
