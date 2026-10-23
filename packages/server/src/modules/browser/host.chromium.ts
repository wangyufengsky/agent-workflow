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
    launched ??= chromium.launch({ headless: true });
    return launched;
  };
  const contexts = new Map<string, BrowserContext>();
  const tabs = new Map<string, Tab>();
  const listeners = new Set<(event: BrowserPortEvent) => void>();
  const emit = (event: BrowserPortEvent) => {
    for (const listener of listeners) listener(event);
  };

  function tabOf(tabId: string): Tab {
    const tab = tabs.get(tabId);
    if (tab === undefined) throw new Error(`No browser tab ${tabId}`);
    return tab;
  }

  async function open(op: Extract<BrowserPortOp, { kind: 'open' }>): Promise<null> {
    const context = contexts.get(op.partition) ?? (await (await browser()).newContext({ acceptDownloads: false }));
    contexts.set(op.partition, context);
    const page = await context.newPage();
    const tab: Tab = { page, session: await context.newCDPSession(page), policy: op.policy, userFacing: op.userFacing };
    tabs.set(op.tabId, tab);
    const blocked = (url: string, method: string, isWebSocket: boolean) => {
      const reason = blockReason({ url, method, isWebSocket }, tab.policy, !tab.userFacing);
      if (reason !== null) emit({ type: 'browser.blocked', tabId: op.tabId, url, method, reason });
      return reason;
    };
    await page.route('**/*', async (route, request) => {
      if (blocked(request.url(), request.method(), false) === null) await route.fallback();
      else await route.abort('blockedbyclient');
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
