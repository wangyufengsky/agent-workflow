import {
  AppError,
  BROWSER_SETTLE_QUIET_MS,
  BROWSER_SETTLE_TIMEOUT_MS,
  BROWSER_SNAPSHOT_MAX_CHARS,
  type BrowserActionOutput,
  BrowserBlockReason,
  type BrowserPolicy,
  type BrowserTabKind,
  ErrorCode,
  VIEWPORT_SIZES,
  type ViewportPreset,
} from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import type { BrowserHost } from './browser.host.ts';
import { createNetworkTracker } from './browser.settle.ts';
import { axNodeSchema, formatSnapshot } from './browser.snapshot.ts';

export type ConsoleEntry = { level: 'error' | 'warning'; text: string; source: string | null };
export type ExceptionEntry = { message: string; source: string | null };
export type RequestEntry = {
  method: string;
  url: string;
  status: number | null;
  resourceType: string;
  error: string | null;
  blocked: BrowserBlockReason | null;
};

/** CDP event params the tab reads; they come from the browser, so they are parsed (06 §1). */
const frameNavigatedSchema = z.object({
  frame: z.object({ id: z.string(), url: z.string(), parentId: z.string().optional() }),
});
const dialogSchema = z.object({ type: z.string(), message: z.string() });
const exceptionSchema = z.object({
  exceptionDetails: z.object({
    text: z.string(),
    url: z.string().optional(),
    exception: z.object({ description: z.string().optional() }).optional(),
  }),
});
const consoleSchema = z.object({
  type: z.string(),
  args: z.array(z.object({ value: z.unknown().optional(), description: z.string().optional() })),
  stackTrace: z.object({ callFrames: z.array(z.object({ url: z.string() })) }).optional(),
});
const requestSentSchema = z.object({
  requestId: z.string(),
  frameId: z.string().optional(),
  type: z.string().optional(),
  request: z.object({ url: z.string(), method: z.string() }),
});
const responseSchema = z.object({ requestId: z.string(), response: z.object({ status: z.number() }) });
const loadingFailedSchema = z.object({ requestId: z.string(), errorText: z.string() });
const loadingFinishedSchema = z.object({ requestId: z.string() });
const evaluateSchema = z.object({ result: z.object({ value: z.unknown().optional() }) });

/** Removed from websites' pages for the AI: write channels the request filter cannot see (29 §5.4). */
const NO_REALTIME =
  'delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection; delete window.WebTransport;';

/** Resolves when the page has had no DOM change for `quiet` ms, false after `timeout` ms (page-side timers). */
const DOM_QUIET = (quiet: number, timeout: number) => `new Promise((resolve) => {
  let timer = setTimeout(done, ${quiet});
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ${quiet}); });
  const limit = setTimeout(() => { observer.disconnect(); clearTimeout(timer); resolve(false); }, ${timeout});
  function done() { observer.disconnect(); clearTimeout(limit); resolve(true); }
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})`;

export type TabInput = {
  host: BrowserHost;
  clock: Clock;
  log: Logger;
  tabId: string;
  kind: BrowserTabKind;
  partition: string;
  policy: BrowserPolicy;
  /** Websites lose their realtime write channels (29 §5.4). */
  site: boolean;
  /** The user's own tab, placed on the window by the renderer (29 §8.1): sized by its place, files can be chosen. */
  userFacing?: boolean;
};

/**
 * One AI tab (29 §5.3): its page's refs, logs and network, and what changed since the action began (navigation,
 * dialogs, blocked writes, new errors) for the action's result.
 */
export async function openTab({
  host,
  clock,
  log,
  tabId,
  kind,
  partition,
  policy,
  site,
  userFacing = false,
}: TabInput) {
  const viewport: { preset: ViewportPreset } = { preset: 'desktop' };
  let refs = new Map<string, number>();
  const consoleEntries: ConsoleEntry[] = [];
  const exceptions: ExceptionEntry[] = [];
  const requests = new Map<string, RequestEntry>();
  const blockedUrls = new Map<string, BrowserBlockReason>();
  const network = createNetworkTracker(clock, BROWSER_SETTLE_QUIET_MS);
  let logCursor = { console: 0, exceptions: 0, requests: 0 };
  const since = { navigated: false, dialog: null as string | null, blockedWrites: [] as string[], loaded: true };
  let mark = { console: 0, exceptions: 0, failed: 0 };
  /** Where this action's entries start, for the facts of one page (a page check, 29 §7.2). */
  let start = { console: 0, exceptions: 0, requests: 0 };
  /** The main frame and its address, and where its current document's entries start (the user's counts, 29 §8.1). */
  let mainFrame: string | null = null;
  let url = '';
  let page = { console: 0, exceptions: 0, requests: 0 };
  let onLoad = () => {};
  /** Told when the page's address or its error counts change. */
  let changed = () => {};

  const cdp = (method: string, params?: Record<string, unknown>) =>
    host.request({ kind: 'cdp', tabId, method, params });
  const failedRequests = () => [...requests.values()].filter((r) => r.error !== null || (r.status ?? 0) >= 400);
  const consoleErrors = () => consoleEntries.filter((e) => e.level === 'error').length;

  function onCdp(method: string, params: unknown): void {
    switch (method) {
      case 'Page.frameNavigated': {
        const { frame } = frameNavigatedSchema.parse(params);
        if (frame.parentId !== undefined) return;
        mainFrame = frame.id;
        url = frame.url;
        // Refs name nodes of the page that was left (29 §5.5).
        refs = new Map();
        since.navigated = true;
        since.loaded = false;
        changed();
        return;
      }
      case 'Page.loadEventFired':
        since.loaded = true;
        onLoad();
        return;
      case 'Page.javascriptDialogOpening': {
        const { type, message } = dialogSchema.parse(params);
        // An unanswered dialog freezes the page: alert and confirm are accepted, prompt dismissed (29 §5.5).
        const accept = type !== 'prompt';
        since.dialog = `页面弹出${type}「${message}」，已${accept ? '点确定' : '取消'}`;
        // The page may have closed the dialog itself meanwhile; nothing then waits for the answer.
        cdp('Page.handleJavaScriptDialog', { accept }).catch((err: unknown) =>
          log.warn({ err, tabId }, 'browser dialog answer failed'),
        );
        return;
      }
      case 'Runtime.exceptionThrown': {
        const { exceptionDetails: d } = exceptionSchema.parse(params);
        exceptions.push({ message: d.exception?.description ?? d.text, source: d.url ?? null });
        changed();
        return;
      }
      case 'Runtime.consoleAPICalled': {
        const { type, args, stackTrace } = consoleSchema.parse(params);
        if (type !== 'error' && type !== 'warning') return;
        const text = args
          .map((a) => (typeof a.value === 'string' ? a.value : (a.description ?? String(a.value))))
          .join(' ');
        consoleEntries.push({ level: type, text, source: stackTrace?.callFrames[0]?.url ?? null });
        if (type === 'error') changed();
        return;
      }
      case 'Network.requestWillBeSent': {
        const { requestId, frameId, type, request } = requestSentSchema.parse(params);
        // A new document of the main frame starts its page's counts, its own request included.
        if (type === 'Document' && frameId === mainFrame && !requests.has(requestId)) {
          page = { console: consoleEntries.length, exceptions: exceptions.length, requests: requests.size };
        }
        requests.set(requestId, {
          method: request.method,
          url: request.url,
          status: null,
          resourceType: type ?? 'Other',
          error: null,
          blocked: null,
        });
        network.onEvent(method, { requestId, ...(type === undefined ? {} : { type }) });
        return;
      }
      case 'Network.responseReceived': {
        const { requestId, response } = responseSchema.parse(params);
        const entry = requests.get(requestId);
        if (entry !== undefined) entry.status = response.status;
        if (response.status >= 400) changed();
        return;
      }
      case 'Network.loadingFinished':
        network.onEvent(method, loadingFinishedSchema.parse(params));
        return;
      case 'Network.loadingFailed': {
        const { requestId, errorText } = loadingFailedSchema.parse(params);
        const entry = requests.get(requestId);
        if (entry !== undefined) {
          entry.error = errorText;
          entry.blocked = blockedUrls.get(entry.url) ?? null;
        }
        network.onEvent(method, { requestId });
        changed();
        return;
      }
    }
  }

  const unsubscribe = host.onEvent((event) => {
    if (event.tabId !== tabId) return;
    if (event.type === 'browser.cdpEvent') onCdp(event.method, event.params);
    else if (event.type === 'browser.blocked') {
      blockedUrls.set(event.url, event.reason);
      if (event.reason === BrowserBlockReason.ReadOnly) {
        since.blockedWrites.push(`${event.method} ${new URL(event.url).pathname}`);
      }
    }
  });

  await host.request({
    kind: 'open',
    tabId,
    partition,
    userFacing,
    viewport: userFacing ? null : VIEWPORT_SIZES.desktop,
    policy,
  });
  for (const domain of ['Page', 'Runtime', 'Network', 'DOM', 'Accessibility']) await cdp(`${domain}.enable`);
  // File choosers would open a dialog nobody answers (29 §5.4); the user answers their own.
  if (!userFacing) await cdp('Page.setInterceptFileChooserDialog', { enabled: true });
  if (site) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: NO_REALTIME });

  async function evaluate(expression: string): Promise<unknown> {
    const { result } = evaluateSchema.parse(
      await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    );
    return result.value;
  }

  const tab = {
    tabId,
    kind,
    viewport,
    cdp,
    evaluate,
    refOf(ref: string): number {
      const node = refs.get(ref);
      if (node === undefined) {
        throw new AppError(ErrorCode.BrowserRefStale, `No element ${ref} on the current page`, { ref });
      }
      return node;
    },

    /** Starts an action: its result reports what happens from here. */
    begin(): void {
      since.navigated = false;
      since.dialog = null;
      since.blockedWrites = [];
      mark = { console: consoleErrors(), exceptions: exceptions.length, failed: failedRequests().length };
      start = { console: consoleEntries.length, exceptions: exceptions.length, requests: requests.size };
    },

    /** The main frame's address (empty before the first navigation). */
    url: () => url,

    /** Console errors (uncaught exceptions included) and failed requests of the current document (29 §8.1). */
    pageCounts(): { consoleErrors: number; failedRequests: number } {
      const reqs = [...requests.values()].slice(page.requests);
      return {
        consoleErrors:
          consoleEntries.slice(page.console).filter((e) => e.level === 'error').length +
          exceptions.length -
          page.exceptions,
        failedRequests: reqs.filter((r) => r.error !== null || (r.status ?? 0) >= 400).length,
      };
    },

    onChange(listener: () => void): void {
      changed = listener;
    },

    /** What the page did since `begin`: its console, uncaught exceptions and every request in order. */
    facts(): { console: ConsoleEntry[]; exceptions: ExceptionEntry[]; requests: RequestEntry[] } {
      return {
        console: consoleEntries.slice(start.console),
        exceptions: exceptions.slice(start.exceptions),
        requests: [...requests.values()].slice(start.requests),
      };
    },

    /** The page loaded (when it navigated), then network and DOM quiet; false when that took too long (29 §5.5). */
    async settle(): Promise<boolean> {
      const deadline = clock.now() + BROWSER_SETTLE_TIMEOUT_MS;
      if (!since.loaded) {
        const loaded = await new Promise<boolean>((resolve) => {
          const cancel = clock.schedule(BROWSER_SETTLE_TIMEOUT_MS, () => resolve(false));
          onLoad = () => {
            cancel();
            resolve(true);
          };
        });
        if (!loaded) return false;
      }
      const left = Math.max(0, deadline - clock.now());
      const [networkQuiet, domQuiet] = await Promise.all([
        network.whenQuiet(left),
        evaluate(DOM_QUIET(BROWSER_SETTLE_QUIET_MS, left)),
      ]);
      return networkQuiet && domQuiet === true;
    },

    async snapshot(): Promise<{ url: string; title: string; page: string }> {
      const { nodes } = z.object({ nodes: z.array(axNodeSchema) }).parse(await cdp('Accessibility.getFullAXTree'));
      const location = z
        .object({ url: z.string(), title: z.string() })
        .parse(await evaluate('({ url: location.href, title: document.title })'));
      const formatted = formatSnapshot(nodes, BROWSER_SNAPSHOT_MAX_CHARS);
      refs = formatted.refs;
      const { width, height } = VIEWPORT_SIZES[viewport.preset];
      const header = `页面 ${new URL(location.url).pathname} · ${location.title} · ${viewport.preset} ${width}×${height} · 控制台错误 ${consoleErrors()} · 失败请求 ${failedRequests().length}`;
      return { ...location, page: `${header}\n${formatted.text}` };
    },

    /** The result of an action (29 §6): what happened since `begin`, and the page now. */
    async result(settled: boolean): Promise<BrowserActionOutput> {
      return {
        ...(await tab.snapshot()),
        tab: kind,
        navigated: since.navigated,
        settled,
        dialog: since.dialog,
        blockedWrites: [...since.blockedWrites],
        newErrors: {
          console: consoleErrors() - mark.console,
          exceptions: exceptions.length - mark.exceptions,
          requests: failedRequests().length - mark.failed,
        },
      };
    },

    /** Console errors and warnings, exceptions and failed requests; `last`: only what is new since the last call. */
    logs(range: 'open' | 'last') {
      const failed = failedRequests();
      const from = range === 'open' ? { console: 0, exceptions: 0, requests: 0 } : logCursor;
      logCursor = { console: consoleEntries.length, exceptions: exceptions.length, requests: failed.length };
      return {
        console: consoleEntries.slice(from.console),
        exceptions: exceptions.slice(from.exceptions),
        requests: failed.slice(from.requests),
      };
    },

    setPolicy: (next: BrowserPolicy) => host.request({ kind: 'setPolicy', tabId, policy: next }),

    async close(): Promise<void> {
      unsubscribe();
      await host.request({ kind: 'close', tabId });
    },
  };
  return tab;
}

export type Tab = Awaited<ReturnType<typeof openTab>>;
