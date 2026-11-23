import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ACTIVE_ATTEMPT_STATUSES,
  AcceptanceCheckKind,
  AppError,
  ATTEMPT_STATUSES,
  BROWSER_FRAME_QUALITY,
  BROWSER_FRAME_WIDTH,
  BROWSER_READ_TIMEOUT_MS,
  type BrowserActionOutput,
  type BrowserCaseAssertion,
  type BrowserCaseChallenge,
  type BrowserFrame,
  type BrowserKey,
  type BrowserNetwork,
  type BrowserPage,
  type BrowserPolicy,
  BrowserTabKind,
  type BrowserTestAction,
  type BrowserTestScope,
  type BrowserTestTab,
  browserFrameSchema,
  browserTestActionSchema,
  ErrorCode,
  McpToolName,
  PAGE_CHECK_SHOT_MAX_HEIGHT,
  PageCheckUnrunnable,
  PreviewState,
  type RequestChangesRequest,
  ServerEventType,
  SiteAccess,
  TaskStatus,
  type UserTabState,
  urlAccess,
  VIEWPORT_SIZES,
  type ViewportPreset,
} from '@aw/shared';
import axe from 'axe-core';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { PreviewsService } from '../previews/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createActions } from './browser.actions.ts';
import { evaluateCaseAssertion, resolveCaseRef } from './browser.case-dom.ts';
import { createCaseHandoffs, detectCaseChallenge } from './browser.case-handoff.ts';
import { type PageCheckPage, type PageCheckResult, pageCheckOutput, pageCheckVerdict } from './browser.check.ts';
import { type BrowserActivity, createBrowserControl } from './browser.control.ts';
import { createFrontendPreview } from './browser.frontend.ts';
import type { BrowserHost } from './browser.host.ts';
import { openTab, type RequestEntry, type Tab } from './browser.tab.ts';
import { browserTestPath, browserTestRequests } from './browser.test-evidence.ts';

export type BrowserServiceDeps = {
  host: BrowserHost;
  clock: Clock;
  log: Logger;
  events: EventBus;
  activity: BrowserActivity;
  settings: SettingsService;
  /** The network settings every tab's partition follows (D176). */
  network: () => BrowserNetwork;
  projects: ProjectsService;
  previews: PreviewsService;
  /** Page checks' screenshots go under `runs/<taskId>/browser/` (29 §7.4). */
  dataDir: string;
  /** Where an attempt's files go (its transcript's directory), to read its screenshots and frames back (29 §5.7). */
  attemptFilesDir: (attemptId: string) => string;
};

export type PageCheckRequest = {
  taskId: string;
  projectId: string;
  nodeId: string;
  pages: readonly string[];
  viewports: readonly ViewportPreset[];
};

/** Who uses the browser (an attempt, 29 §5.3) and where its screenshots go (beside its transcript, 29 §5.7). */
export type BrowserOwner = {
  id: string;
  taskId: string | null;
  projectId: string | null;
  filesDir: string;
  browserTest?: BrowserTestScope | null;
  /** 保存的用例在自己的步骤循环中处理接管。 */
  savedCase?: boolean;
  waitForUser?: (wait: () => Promise<void>) => Promise<void>;
};

function usesProjectPreview(owner: BrowserOwner): boolean {
  return owner.browserTest == null || owner.browserTest.target.startsWith('/');
}

type Session = {
  owner: BrowserOwner;
  tabs: Partial<Record<BrowserTabKind, Tab>>;
  opening: Partial<Record<BrowserTabKind, Promise<Tab>>>;
  current: Tab | null;
  shots: number;
  frames: number;
  testActions: number;
  acceptedChallenge: string | null;
  testActionActive: boolean;
  testActionTarget?: string;
  /** What each page the owner read said, by address without its fragment (29 §2.8). */
  pages: Map<string, string>;
};
/** The tools whose action may change the page: each leaves a frame for the user to watch (29 §8.2). */
type ActingTool =
  | typeof McpToolName.BrowserOpen
  | typeof McpToolName.BrowserClick
  | typeof McpToolName.BrowserType
  | typeof McpToolName.BrowserSelect
  | typeof McpToolName.BrowserPress
  | typeof McpToolName.BrowserViewport
  | typeof McpToolName.BrowserWaitFor;

/** The websites' partition: the user's logins, which the AI's website tabs share (29 §5.4). */
const SITES_PARTITION = 'persist:aw-sites';
const cookiesSchema = z.object({
  cookies: z.array(z.object({ name: z.string(), domain: z.string(), path: z.string() })),
});
const hostOfCookie = (domain: string) => domain.replace(/^\./, '');

/** Host or path fragments of login pages, besides `browser.loginUrlPatterns` (29 §5.4). */
const LOGIN_HINTS = ['login', 'signin', 'sign-in', 'sso', 'cas', 'oauth'];
const ENDED = new Set<string>(ATTEMPT_STATUSES.filter((s) => !ACTIVE_ATTEMPT_STATUSES.includes(s)));

const navigateSchema = z.object({ errorText: z.string().optional(), loaderId: z.string().optional() });
/** An address as a citation names a page: without its fragment. */
function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}
const visualViewportSchema = z.object({
  cssVisualViewport: z.object({
    pageX: z.number(),
    pageY: z.number(),
    clientWidth: z.number(),
    clientHeight: z.number(),
  }),
});
/** An attempt's frames, one JSON line each, beside their images (29 §5.7). */
const TEST_ACTIONS_INDEX = 'test-actions.jsonl';
const FRAMES_INDEX = 'frames.jsonl';
/** The only files read back from an attempt's folder: screenshots (`3.jpg`) and frames (`f3.jpg`). */
export const ATTEMPT_FILE = /^f?\d+\.jpg$/;
const layoutSchema = z.object({ cssContentSize: z.object({ width: z.number(), height: z.number() }) });
const a11ySchema = z.array(z.object({ id: z.string(), help: z.string(), nodes: z.number() }));
/** axe-core's rules of critical or serious impact only (29 §7.2); `axe` was injected first. */
const AXE_RUN = `axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations
  .filter((v) => v.impact === 'critical' || v.impact === 'serious')
  .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length })))`;
const OVERFLOW = 'document.scrollingElement.scrollWidth > innerWidth';

const pageCheckResult = (
  pages: PageCheckResult['pages'],
  output: string,
  unrunnable: PageCheckResult['unrunnable'] = null,
): PageCheckResult => ({
  kind: AcceptanceCheckKind.Browser,
  passed: unrunnable === null && pages.length > 0 && pages.every((p) => p.errors.length === 0),
  pages,
  output,
  unrunnable,
  skipped: false,
});

/** The AI's browser (29 §5–§6): an owner's two tabs, what they may open, and the tools' actions on them. */
export function createBrowserService({
  host,
  clock,
  log,
  events,
  activity,
  settings,
  network,
  projects,
  previews,
  dataDir,
  attemptFilesDir,
}: BrowserServiceDeps) {
  const sessions = new Map<string, Session>();
  const frontend = createFrontendPreview(host, dataDir);
  /** The user's own preview tabs (29 §8.1), by tab id. */
  const userTabs = new Map<string, { tab: Tab; taskId: string; projectId: string }>();
  /** The preview tab the UI bound to each assistant conversation (15, 29 §8.1): only what the user is looking at. */
  const boundPreviews = new Map<string, string>();
  /** User preview operations waiting on the page; closing the browser ends them. */
  const waiting = new Set<AbortController>();
  /** Opens of a task's preview tab in progress: a second open joins the first. */
  const openingUserTabs = new Map<string, Promise<UserTabState>>();
  const actions = createActions(clock);
  const control = createBrowserControl(actions, log, activity);
  const handoffs = createCaseHandoffs();
  const unsubscribeHost = host.onEvent((event) => {
    // The page that placed a user's preview tab started over and main closed it (29 §8.1): let go of its preview.
    if (event.type === 'browser.gone') {
      const entry = userTabs.get(event.tabId);
      if (entry === undefined) {
        for (const session of sessions.values()) {
          if (session.current?.tabId !== event.tabId) continue;
          close(session.owner.id).catch((err: unknown) => log.error({ err }, 'lost case tab cleanup failed'));
          break;
        }
        return;
      }
      forgetUserTab(event.tabId);
      entry.tab.dispose();
      return;
    }
    if (event.type !== 'browser.unownedBlocked') return;
    // URL 可能带访问令牌，结构化日志只保留资源种类与清理结果。
    log.warn({ source: event.source, cleanupError: event.cleanupError }, 'browser unowned worker blocked');
  });

  function policyFor(owner: Pick<BrowserOwner, 'taskId' | 'projectId' | 'browserTest'>): BrowserPolicy {
    const preview = owner.taskId === null ? null : previews.get(owner.taskId);
    if (owner.browserTest != null) {
      const target = owner.browserTest.target;
      const origin = target.startsWith('/') ? preview?.url : new URL(target).origin;
      return {
        previewOrigins: origin == null ? [] : [origin],
        sites: [],
        automation: { origin: origin ?? '', writes: owner.browserTest.writes },
      };
    }
    const extra = owner.projectId === null ? [] : (projects.getRecord(owner.projectId).preview?.extraOrigins ?? []);
    return {
      previewOrigins: preview?.url === null || preview?.url === undefined ? [] : [preview.url, ...extra],
      sites: settings.get('browser.sites'),
    };
  }

  function sessionOf(owner: BrowserOwner): Session {
    const existing = sessions.get(owner.id);
    if (existing !== undefined) return existing;
    const dir = ownerDir(owner);
    const shots = existsSync(dir)
      ? Math.max(
          0,
          ...readdirSync(dir)
            .filter((file) => /^\d+\.jpg$/.test(file))
            .map((file) => Number.parseInt(file, 10)),
        )
      : 0;
    const session: Session = {
      owner,
      tabs: {},
      opening: {},
      current: null,
      shots,
      frames: 0,
      testActions: 0,
      acceptedChallenge: null,
      testActionActive: false,
      pages: new Map(),
    };
    sessions.set(owner.id, session);
    return session;
  }

  function current(owner: BrowserOwner): Tab {
    const tab = sessions.get(owner.id)?.current;
    if (tab === null || tab === undefined) {
      throw new AppError(ErrorCode.ValidationFailed, 'No page is open: call browser_open first');
    }
    if (owner.waitForUser !== undefined && handoffs.controls(tab.tabId))
      throw new AppError(
        ErrorCode.BrowserLoginRequired,
        'The current test tab is waiting for the user to finish verification',
      );
    return tab;
  }

  async function tabFor(session: Session, kind: BrowserTabKind, signal?: AbortSignal): Promise<Tab> {
    const existing = session.tabs[kind];
    if (existing !== undefined) return existing;
    const opening = session.opening[kind];
    if (opening !== undefined) return opening;
    const { owner } = session;
    const pending = openTab({
      host,
      clock,
      log,
      tabId: `${owner.id}:${kind}`,
      ...(signal === undefined ? {} : { signal }),
      ...(owner.browserTest == null ? {} : { caseSession: true }),
      kind,
      // 浏览器测试与预览按尝试隔离，普通网站才共享用户登录分区。
      partition:
        owner.browserTest != null || kind === BrowserTabKind.Preview ? `aw-attempt-${owner.id}` : SITES_PARTITION,
      policy: policyFor(owner),
      integratedAuthServers: kind === BrowserTabKind.Site && owner.browserTest == null ? integratedAuthServers() : [],
      network: network(),
      site: kind === BrowserTabKind.Site,
    }).then(async (tab) => {
      if (sessions.get(owner.id) !== session) {
        await tab.close();
        throw new AppError(ErrorCode.BrowserNotOpen, 'The browser attempt ended');
      }
      session.tabs[kind] = tab;
      if (kind === BrowserTabKind.Preview && owner.taskId !== null && usesProjectPreview(owner))
        previews.acquire(owner.taskId);
      return tab;
    });
    session.opening[kind] = pending;
    try {
      return await pending;
    } finally {
      delete session.opening[kind];
    }
  }

  /** The websites' partition logs in to these with the user's system login (29 §5.4). */
  const integratedAuthServers = () => settings.get('browser.integratedAuthServers');

  /**
   * Where a website tab now at `url` asks to log in (29 §5.4), or null: credentials only the user gives (HTTP
   * authentication, a client certificate), or a page that looks like a login page.
   */
  async function loginAt(tab: Tab, url: string, checkUrl = true): Promise<string | null> {
    const asked = tab.credentialsAsked();
    if (asked !== null) return asked;
    const { hostname, pathname } = new URL(url);
    const where = `${hostname}${pathname}`.toLowerCase();
    if (
      checkUrl &&
      [...LOGIN_HINTS, ...settings.get('browser.loginUrlPatterns')].some((hint) => where.includes(hint.toLowerCase()))
    ) {
      return url;
    }
    return (await tab.evaluate('document.querySelectorAll("input[type=password]").length')) === 1 ? url : null;
  }

  /** The folder of an owner's screenshots and frames (29 §5.7). */
  const ownerDir = (owner: Pick<BrowserOwner, 'id' | 'filesDir'>) => join(owner.filesDir, 'browser', owner.id);

  /**
   * What the page shows after an action, for the user to watch (29 §8.2): the visible part scaled to
   * BROWSER_FRAME_WIDTH, indexed and announced; never given to the model.
   */
  async function frame(owner: BrowserOwner, tab: Tab, tool: ActingTool, url: string): Promise<string> {
    const session = sessionOf(owner);
    const { cssVisualViewport: v } = visualViewportSchema.parse(await tab.cdp('Page.getLayoutMetrics'));
    const { data } = z.object({ data: z.string() }).parse(
      await tab.cdp('Page.captureScreenshot', {
        format: 'jpeg',
        quality: BROWSER_FRAME_QUALITY,
        clip: {
          x: v.pageX,
          y: v.pageY,
          width: v.clientWidth,
          height: v.clientHeight,
          scale: Math.min(1, BROWSER_FRAME_WIDTH / v.clientWidth),
        },
      }),
    );
    const dir = ownerDir(owner);
    mkdirSync(dir, { recursive: true });
    const seq = ++session.frames;
    const item: BrowserFrame = { attemptId: owner.id, taskId: owner.taskId, seq, tool, url, file: `f${seq}.jpg` };
    await writeFile(join(dir, item.file), Buffer.from(data, 'base64'));
    await appendFile(join(dir, FRAMES_INDEX), `${JSON.stringify(item)}\n`);
    events.publish({ type: ServerEventType.BrowserFrame, data: item });
    return item.file;
  }

  function notifyTest(owner: BrowserOwner): void {
    if (owner.browserTest != null && owner.taskId !== null)
      events.publish({ type: ServerEventType.BrowserTestUpdated, data: { taskId: owner.taskId, attemptId: owner.id } });
  }

  function testTab(taskId: string): BrowserTestTab | undefined {
    const session = [...sessions.values()].find((s) => s.owner.taskId === taskId && s.owner.browserTest != null);
    const tab = session?.current;
    if (session === undefined || tab == null) return undefined;
    return {
      tabId: tab.tabId,
      attemptId: session.owner.id,
      path: browserTestPath(tab.url()),
      viewport: tab.viewport.preset,
    };
  }

  async function waitForTestUser(owner: BrowserOwner, tab: Tab, beforeHandoff?: RequestEntry[]): Promise<boolean> {
    if (owner.waitForUser === undefined || owner.taskId === null) return false;
    const session = sessions.get(owner.id);
    if (session === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'The browser attempt ended');
    if (handoffs.controls(tab.tabId))
      throw new AppError(
        ErrorCode.BrowserLoginRequired,
        'The current test tab is waiting for the user to finish verification',
      );
    const challenge = await detectCaseChallenge(tab);
    if (challenge === null) {
      session.acceptedChallenge = null;
      return false;
    }
    if (!challenge.persistent && challenge.key === session.acceptedChallenge) return false;
    const taskId = owner.taskId;
    beforeHandoff?.push(...tab.facts().requests);
    await owner.waitForUser(() => handoffs.wait(taskId, tab, () => policyFor(owner), null, challenge.reason));
    const remaining = await detectCaseChallenge(tab);
    session.acceptedChallenge = remaining?.persistent === false ? remaining.key : null;
    tab.begin();
    return true;
  }

  async function recordTestAction(
    owner: BrowserOwner,
    tab: Tab,
    tool: ActingTool,
    outcome: { passed: boolean; errorCode: ErrorCode | null },
    requests: RequestEntry[],
  ): Promise<void> {
    const session = sessions.get(owner.id);
    if (session === undefined || owner.savedCase === true) return;
    const item: BrowserTestAction = {
      seq: ++session.testActions,
      tool,
      path: browserTestPath(tab.url()),
      ...(session.testActionTarget === undefined ? {} : { target: session.testActionTarget }),
      ...outcome,
      requests: browserTestRequests(requests),
    };
    const dir = ownerDir(owner);
    mkdirSync(dir, { recursive: true });
    await appendFile(join(dir, TEST_ACTIONS_INDEX), `${JSON.stringify(item)}\n`);
    notifyTest(owner);
  }

  async function observeAction<T extends { url: string }>(
    owner: BrowserOwner,
    tab: Tab,
    tool: ActingTool,
    run: (beforeHandoff: RequestEntry[]) => Promise<T>,
    met: (output: T) => boolean = () => true,
  ): Promise<T & { frame?: string }> {
    if (owner.browserTest == null) {
      const output = await run([]);
      return { ...output, frame: await frame(owner, tab, tool, output.url) };
    }
    if (handoffs.controls(tab.tabId))
      throw new AppError(
        ErrorCode.BrowserLoginRequired,
        'The current test tab is waiting for the user to finish verification',
      );
    const session = sessions.get(owner.id);
    if (session === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'The browser attempt ended');
    if (session.testActionActive)
      throw new AppError(ErrorCode.StateTransitionInvalid, 'Wait for the preceding browser action to finish');
    session.testActionActive = true;
    delete session.testActionTarget;
    const beforeHandoff: RequestEntry[] = [];
    try {
      let output: T;
      try {
        output = await run(beforeHandoff);
      } catch (err) {
        await recordTestAction(
          owner,
          tab,
          tool,
          { passed: false, errorCode: err instanceof AppError ? err.code : ErrorCode.BrowserActionFailed },
          [...beforeHandoff, ...tab.facts().requests],
        );
        throw err;
      }
      await recordTestAction(owner, tab, tool, { passed: met(output), errorCode: null }, [
        ...beforeHandoff,
        ...tab.facts().requests,
      ]);
      return output;
    } finally {
      session.testActionActive = false;
    }
  }

  /**
   * Keeps what a page read by the owner said, under its address and the ones that led to it: a knowledge answer's
   * `web` citation of it stores this text (29 §2.8). The snapshot's header line describes the tab, not the page.
   */
  function remember(owner: BrowserOwner, page: { url: string; page: string }, ...also: string[]): void {
    const text = page.page.slice(page.page.indexOf('\n') + 1);
    const { pages } = sessionOf(owner);
    for (const url of [page.url, ...also]) if (URL.canParse(url)) pages.set(pageKey(url), text);
  }

  function testControlGuard(owner: BrowserOwner, tab: Tab, ref: string | null, forTyping = false) {
    if (owner.browserTest == null) return undefined;
    return async () => {
      const { sensitive, textField, label } = await actions.describeControl(tab, ref);
      if (sensitive || tab.credentialsAsked() !== null)
        throw new AppError(ErrorCode.BrowserLoginRequired, 'The user handles credentials and file inputs');
      if (forTyping && !textField) throw new AppError(ErrorCode.BrowserActionFailed, 'Choose an editable text field');
      const session = sessions.get(owner.id);
      if (ref !== null && session?.testActionActive === true) session.testActionTarget = label;
    };
  }

  async function act(
    owner: BrowserOwner,
    tool: ActingTool,
    run: (tab: Tab) => Promise<void>,
  ): Promise<BrowserActionOutput> {
    const tab = current(owner);
    return observeAction(
      owner,
      tab,
      tool,
      async (beforeHandoff) => {
        tab.begin();
        if (await waitForTestUser(owner, tab, beforeHandoff))
          throw new AppError(
            ErrorCode.BrowserRefStale,
            'The user finished verification. Read the current page and continue this step.',
          );
        await run(tab);
        const settled = await tab.settle();
        const handedOff = await waitForTestUser(owner, tab, beforeHandoff);
        const output = await tab.result(settled || handedOff);
        remember(owner, output);
        return output;
      },
      (output) => output.settled && output.blockedWrites.length === 0,
    );
  }

  /** A short-lived offscreen tab of the websites' partition, for its cookies and storage. */
  async function withSitesTab<T>(
    run: (cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
  ) {
    const tabId = `sites:${randomUUID()}`;
    await host.request({
      kind: 'open',
      tabId,
      partition: SITES_PARTITION,
      userFacing: false,
      viewport: VIEWPORT_SIZES.desktop,
      policy: { previewOrigins: [], sites: [] },
      integratedAuthServers: integratedAuthServers(),
      network: network(),
    });
    try {
      return await run((method, params) => host.request({ kind: 'cdp', tabId, method, params }));
    } finally {
      await host.request({ kind: 'close', tabId });
    }
  }

  async function siteLogins(): Promise<{ hosts: string[] }> {
    return withSitesTab(async (cdp) => {
      const { cookies } = cookiesSchema.parse(await cdp('Network.getAllCookies'));
      return { hosts: [...new Set(cookies.map((c) => hostOfCookie(c.domain)))].sort() };
    });
  }

  async function close(ownerId: string): Promise<void> {
    const session = sessions.get(ownerId);
    if (session === undefined) return;
    sessions.delete(ownerId);
    notifyTest(session.owner);
    for (const tab of Object.values(session.tabs)) {
      handoffs.lost(tab.tabId);
      await tab.close();
    }
    if (session.tabs.preview !== undefined && session.owner.taskId !== null && usesProjectPreview(session.owner))
      previews.release(session.owner.taskId);
  }

  /**
   * One page at one viewport (29 §7.2): its facts judged, and its full page captured into `dir` as `shot` when it
   * loaded.
   */
  async function checkPage(
    tab: Tab,
    url: string,
    dir: string,
    shot: string,
  ): Promise<Omit<PageCheckPage, 'path' | 'viewport'>> {
    tab.begin();
    const { errorText } = navigateSchema.parse(await tab.cdp('Page.navigate', { url }));
    if (errorText !== undefined) {
      const facts = { ...tab.facts(), navigationError: errorText, overflow: false, a11y: [], settled: true };
      return { ...pageCheckVerdict(facts), screenshot: null };
    }
    const settled = await tab.settle();
    const overflow = (await tab.evaluate(OVERFLOW)) === true;
    await tab.evaluate(axe.source);
    const a11y = a11ySchema.parse(await tab.evaluate(AXE_RUN));
    const { cssContentSize } = layoutSchema.parse(await tab.cdp('Page.getLayoutMetrics'));
    const { data } = z.object({ data: z.string() }).parse(
      await tab.cdp('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 70,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: cssContentSize.width,
          height: Math.min(cssContentSize.height, PAGE_CHECK_SHOT_MAX_HEIGHT),
          scale: 1,
        },
      }),
    );
    await writeFile(join(dir, shot), Buffer.from(data, 'base64'));
    return {
      ...pageCheckVerdict({ ...tab.facts(), navigationError: null, overflow, a11y, settled }),
      screenshot: shot,
    };
  }

  /**
   * A user preview operation within BROWSER_READ_TIMEOUT_MS (29 §8.1): past it the operation fails with
   * BROWSER_READ_FAILED; only this wait ends, not the user's page. Late CDP answers are dropped by the signal.
   */
  async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    waiting.add(abort);
    const interrupted = Promise.withResolvers<never>();
    const onAbort = () => interrupted.reject(abort.signal.reason);
    abort.signal.addEventListener('abort', onAbort, { once: true });
    const cancel = clock.schedule(BROWSER_READ_TIMEOUT_MS, () =>
      abort.abort(
        new AppError(ErrorCode.BrowserReadFailed, 'The user preview operation timed out', {
          reason: 'timeout',
          timeoutMs: BROWSER_READ_TIMEOUT_MS,
        }),
      ),
    );
    try {
      return await Promise.race([work(abort.signal), interrupted.promise]);
    } finally {
      cancel();
      waiting.delete(abort);
      abort.signal.removeEventListener('abort', onAbort);
    }
  }

  /** The running preview's origin, or BROWSER_NOT_OPEN for the assistant (a stopped preview reads nothing). */
  function runningPreviewUrl(taskId: string): string {
    const preview = previews.get(taskId);
    if (preview.state !== PreviewState.Running || preview.url === null) {
      throw new AppError(ErrorCode.BrowserNotOpen, 'The selected task preview is not running', { taskId });
    }
    return preview.url;
  }

  function requireFrontendPage(taskId: string, tab: Tab): void {
    const origin = runningPreviewUrl(taskId);
    if (!URL.canParse(tab.url()) || new URL(tab.url()).origin !== origin)
      throw new AppError(ErrorCode.BrowserNotOpen, 'Open a local page in the frontend task preview');
  }

  /** Conversations bound to the tab lose it. */
  function unbindPreview(tabId: string): void {
    for (const [conversationId, bound] of boundPreviews) {
      if (bound !== tabId) continue;
      void control.revoke(conversationId);
      boundPreviews.delete(conversationId);
    }
  }

  /** The tab is no longer the user's: unbound, and its preview free to idle. */
  function forgetUserTab(tabId: string): void {
    const entry = userTabs.get(tabId);
    if (entry === undefined) return;
    userTabs.delete(tabId);
    frontend.forget(tabId);
    unbindPreview(tabId);
    previews.release(entry.taskId);
  }

  /**
   * Opens a path of the task's running preview; a path that would leave its origin (`/\\host`) is refused, a page that
   * does not load is an error, not content.
   */
  async function navigatePreview(tab: Tab, taskId: string, path: string, signal: AbortSignal): Promise<void> {
    const origin = runningPreviewUrl(taskId);
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new AppError(ErrorCode.ValidationFailed, 'Preview navigation needs a local path');
    const previous = tab.documentVersion();
    const { errorText, loaderId } = navigateSchema.parse(await tab.cdp('Page.navigate', { url: url.href }));
    signal.throwIfAborted();
    if (errorText !== undefined) {
      throw new AppError(ErrorCode.BrowserReadFailed, 'The preview page could not be loaded', { reason: errorText });
    }
    // Page.navigate 确认启动，实际提交后当前页签才具备授权所需的来源。
    if (loaderId !== undefined && !(await tab.waitForDocument(previous)))
      throw new AppError(ErrorCode.BrowserReadFailed, 'The preview document did not commit');
    signal.throwIfAborted();
  }

  /** A new preview tab of the task, timed from the preview being ready; a tab that does not open in time goes. */
  async function openNewUserTab(taskId: string): Promise<UserTabState> {
    await previews.start(taskId);
    const projectId = previews.projectOf(taskId);
    const tabId = `user-preview:${randomUUID()}`;
    let tab: Tab | undefined;
    try {
      return await withinDeadline(async (signal) => {
        tab = await openTab({
          host,
          clock,
          log,
          tabId,
          kind: BrowserTabKind.Preview,
          partition: `persist:aw-preview-${projectId}`,
          policy: policyFor({ taskId, projectId }),
          integratedAuthServers: [],
          network: network(),
          site: false,
          userFacing: true,
          signal,
        });
        signal.throwIfAborted();
        userTabs.set(tabId, { tab, taskId, projectId });
        previews.acquire(taskId);
        tab.onChange(() => events.publish({ type: ServerEventType.BrowserTabUpdated, data: userTabState(tabId) }));
        await navigatePreview(tab, taskId, projects.getRecord(projectId).preview?.pages[0] ?? '/', signal);
        return userTabState(tabId);
      });
    } catch (err) {
      if (userTabs.has(tabId)) await closeUserTab(tabId);
      else await tab?.close();
      throw err;
    }
  }

  function userTabOf(tabId: string) {
    const entry = userTabs.get(tabId);
    if (entry === undefined) throw new AppError(ErrorCode.NotFound, `No preview tab ${tabId}`, { tabId });
    return entry;
  }

  function userTabState(tabId: string): UserTabState {
    const { tab, taskId } = userTabOf(tabId);
    return {
      tabId,
      taskId,
      url: tab.url(),
      viewport: tab.viewport.preset,
      ...tab.pageCounts(),
      ...(frontend.isArmed(tabId) ? { picking: true } : {}),
    };
  }

  async function closeUserTab(tabId: string): Promise<void> {
    const entry = userTabs.get(tabId);
    if (entry === undefined) {
      // A login tab (29 §8.6): only the host has it.
      await host.request({ kind: 'close', tabId });
      return;
    }
    forgetUserTab(tabId);
    await entry.tab.close();
  }

  events.subscribe((event) => {
    // A finished task's preview tabs close; the browser module does not depend on tasks (29 §5.3, §11).
    if (
      event.type === ServerEventType.TaskUpdated &&
      (event.data.status === TaskStatus.Completed || event.data.status === TaskStatus.Cancelled)
    ) {
      for (const [tabId, entry] of userTabs) {
        if (entry.taskId !== event.data.id) continue;
        closeUserTab(tabId).catch((err: unknown) => log.error({ err }, 'preview tab close failed'));
      }
    }
    // An attempt's tabs end with it; the browser module does not depend on attempts (29 §11).
    if (event.type === ServerEventType.AttemptUpdated && ENDED.has(event.data.attempt.status)) {
      close(event.data.attempt.id).catch((err: unknown) => log.error({ err }, 'browser tabs close failed'));
    }
    // A preview restarted on another port: the tabs of its task follow its origin.
    if (event.type === ServerEventType.PreviewUpdated && event.data.state === PreviewState.Running) {
      const tabs = [
        ...[...sessions.values()].flatMap((s) =>
          s.owner.taskId === event.data.taskId ? Object.values(s.tabs).map((tab) => ({ tab, owner: s.owner })) : [],
        ),
        ...[...userTabs.values()].filter((u) => u.taskId === event.data.taskId).map((u) => ({ tab: u.tab, owner: u })),
      ];
      for (const { tab, owner } of tabs) {
        if (control.hasPolicy(tab.tabId) || handoffs.controls(tab.tabId)) continue;
        tab.setPolicy(policyFor(owner)).catch((err: unknown) => log.error({ err }, 'browser policy update failed'));
      }
    }
    // A stopped preview's page is gone: the assistant may not read it any more (the user reopens it).
    if (
      event.type === ServerEventType.PreviewUpdated &&
      (event.data.state === PreviewState.Stopped || event.data.state === PreviewState.Failed)
    ) {
      for (const [tabId, entry] of userTabs) if (entry.taskId === event.data.taskId) unbindPreview(tabId);
    }
  });

  return {
    /** 助手按明确地址读取网站，不把任何尝试的页面冒充为用户当前页面。 */
    async readUrl(url: string) {
      const normalized = new URL(url).href;
      // 即使用户允许任务操作这个网站，助手读取也不能触发页面脚本的写请求。
      const policy: BrowserPolicy = {
        previewOrigins: [],
        sites: settings.get('browser.sites').map((rule) => ({ ...rule, access: SiteAccess.Read })),
      };
      if (urlAccess(normalized, policy) === null) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'No website rule allows this address', {
          host: new URL(normalized).host,
        });
      }
      const abort = new AbortController();
      let tab: Tab | undefined;
      const timeout = Promise.withResolvers<never>();
      const cancelDeadline = clock.schedule(BROWSER_READ_TIMEOUT_MS, () => {
        const error = new AppError(ErrorCode.BrowserReadFailed, 'The website read timed out', {
          url: normalized,
          reason: 'timeout',
          timeoutMs: BROWSER_READ_TIMEOUT_MS,
        });
        abort.abort(error);
        timeout.reject(error);
      });
      async function read() {
        tab = await openTab({
          host,
          clock,
          log,
          tabId: `assistant-read:${randomUUID()}`,
          kind: BrowserTabKind.Site,
          partition: SITES_PARTITION,
          policy,
          integratedAuthServers: integratedAuthServers(),
          network: network(),
          site: true,
          signal: abort.signal,
        });
        abort.signal.throwIfAborted();
        const navigation = z
          .object({ errorText: z.string().optional() })
          .parse(await tab.cdp('Page.navigate', { url: normalized }));
        abort.signal.throwIfAborted();
        // Without the client certificate the website asked for, the connection fails: that is a login to do.
        const certificate = tab.credentialsAsked();
        if (certificate !== null) {
          throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: certificate });
        }
        if (navigation.errorText !== undefined) {
          throw new AppError(ErrorCode.BrowserReadFailed, 'The website could not be loaded', {
            url: normalized,
            reason: navigation.errorText,
          });
        }
        const settled = await tab.settle();
        abort.signal.throwIfAborted();
        const page = await tab.snapshot();
        abort.signal.throwIfAborted();
        const login = await loginAt(tab, page.url);
        abort.signal.throwIfAborted();
        if (login !== null) {
          throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: login });
        }
        return { ...page, tab: BrowserTabKind.Site, settled, logs: tab.logs('open') };
      }
      try {
        return await Promise.race([read(), timeout.promise]);
      } finally {
        cancelDeadline();
        if (tab !== undefined) await tab.close();
      }
    },

    /**
     * `browser_open` (29 §6): a path starting with / opens in the task's preview (started first when needed), a full
     * address in the preview tab or the website tab by the policy.
     */
    async open(owner: BrowserOwner, url: string, signal?: AbortSignal): Promise<BrowserActionOutput> {
      if (owner.browserTest != null && !sessions.has(owner.id) && url !== owner.browserTest.target) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'Open the user-authorized test target first');
      }
      let target = url;
      if (url.startsWith('/') && !/^(?!.*\\)\/(?!\/)/.test(url)) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'Use a path within the preview');
      }
      if (url.startsWith('/') && !usesProjectPreview(owner)) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'Use an absolute address on the approved test site');
      }
      if (url.startsWith('/')) {
        if (owner.taskId === null) {
          throw new AppError(ErrorCode.ValidationFailed, 'Only tasks have a page preview: give a full address', {
            url,
          });
        }
        const preview = await previews.start(owner.taskId);
        target = `${preview.url}${url}`;
      }
      signal?.throwIfAborted();
      const session = sessionOf(owner);
      // Normalized here, as the policy expects (shared has no URL parser).
      const normalized = URL.canParse(target) ? new URL(target).href : target;
      const access = urlAccess(normalized, policyFor(owner));
      if (access === null) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'No website rule allows this address', {
          host: URL.canParse(target) ? new URL(target).host : target,
        });
      }
      const tab = await tabFor(session, access.tab, signal);
      signal?.throwIfAborted();
      const opened = session.current === null;
      session.current = tab;
      if (opened) notifyTest(owner);
      const output = await observeAction(
        owner,
        tab,
        McpToolName.BrowserOpen,
        async (beforeHandoff) => {
          tab.begin();
          await tab.cdp('Page.navigate', { url: normalized });
          const settled = await tab.settle();
          const handedOff = await waitForTestUser(owner, tab, beforeHandoff);
          const result = await tab.result(settled || handedOff);
          const login =
            owner.browserTest != null &&
            owner.waitForUser === undefined &&
            owner.savedCase !== true &&
            URL.canParse(result.url) &&
            urlAccess(result.url, policyFor(owner)) !== null
              ? await loginAt(tab, result.url, access.tab === BrowserTabKind.Site)
              : null;
          if (login !== null) {
            throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: login });
          }
          return result;
        },
        (result) => result.settled && result.blockedWrites.length === 0,
      );
      if (
        owner.browserTest == null &&
        access.tab === BrowserTabKind.Site &&
        URL.canParse(output.url) &&
        urlAccess(output.url, policyFor(owner)) !== null
      ) {
        const login = await loginAt(tab, output.url, true);
        if (login !== null)
          throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: login });
      }
      remember(owner, output, normalized);
      if (owner.savedCase === true) notifyTest(owner);
      return output;
    },

    caseHandoffs: {
      get: handoffs.get,
      take: handoffs.take,
      resume: handoffs.resume,
      async wait(owner: BrowserOwner, step: number, reason: BrowserCaseChallenge, signal: AbortSignal) {
        if (owner.taskId === null) throw new Error('Browser case has no task');
        await handoffs.wait(owner.taskId, current(owner), () => policyFor(owner), step, reason, signal);
      },
    },

    caseChallenge(owner: BrowserOwner) {
      const tab = sessions.get(owner.id)?.current;
      return tab == null ? Promise.resolve(null) : detectCaseChallenge(tab);
    },

    beginCaseStep(owner: BrowserOwner): void {
      sessions.get(owner.id)?.current?.begin();
    },

    caseRequests(owner: BrowserOwner) {
      return sessions.get(owner.id)?.current?.facts().requests ?? [];
    },

    resolveCaseRef: (owner: BrowserOwner, selector: string) => resolveCaseRef(current(owner), selector),
    evaluateCaseAssertion: (owner: BrowserOwner, expect: BrowserCaseAssertion) =>
      evaluateCaseAssertion(current(owner), expect),

    testTab,

    testActions(attemptId: string): BrowserTestAction[] {
      const index = join(ownerDir({ id: attemptId, filesDir: attemptFilesDir(attemptId) }), TEST_ACTIONS_INDEX);
      if (!existsSync(index)) return [];
      return readFileSync(index, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => browserTestActionSchema.parse(JSON.parse(line)));
    },

    async captureTest(taskId: string, attemptId: string): Promise<{ file: string }> {
      const session = sessions.get(attemptId);
      if (
        session === undefined ||
        session.owner.taskId !== taskId ||
        session.owner.browserTest == null ||
        session.current === null ||
        handoffs.controls(session.current.tabId)
      )
        throw new AppError(ErrorCode.BrowserNotOpen, 'The test tab is not available for capture');
      if (await detectCaseChallenge(session.current))
        throw new AppError(ErrorCode.BrowserLoginRequired, 'Finish verification before saving a screenshot');
      const { file } = await this.screenshot(session.owner, { fullPage: false });
      return { file };
    },

    async snapshot(owner: BrowserOwner): Promise<BrowserPage> {
      const tab = current(owner);
      await waitForTestUser(owner, tab);
      const page = await tab.snapshot();
      remember(owner, page);
      return { ...page, tab: tab.kind };
    },

    click: (owner: BrowserOwner, ref: string) =>
      act(owner, McpToolName.BrowserClick, (tab) => actions.click(tab, ref, testControlGuard(owner, tab, ref))),
    type: (owner: BrowserOwner, ref: string, input: { text: string; clear: boolean; submit: boolean }) =>
      act(owner, McpToolName.BrowserType, (tab) =>
        actions.type(tab, ref, input, testControlGuard(owner, tab, ref, true)),
      ),
    select: (owner: BrowserOwner, ref: string, values: readonly string[]) =>
      act(owner, McpToolName.BrowserSelect, (tab) =>
        actions.select(tab, ref, values, testControlGuard(owner, tab, ref)),
      ),
    press: (owner: BrowserOwner, key: BrowserKey) =>
      act(owner, McpToolName.BrowserPress, async (tab) => {
        await testControlGuard(owner, tab, null)?.();
        await actions.press(tab, key);
      }),

    viewport: (owner: BrowserOwner, preset: ViewportPreset) =>
      act(owner, McpToolName.BrowserViewport, async (tab) => {
        const { width, height, mobile } = VIEWPORT_SIZES[preset];
        await tab.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        tab.viewport.preset = preset;
      }),

    async waitFor(owner: BrowserOwner, input: { text: string; gone: boolean; timeoutMs: number }) {
      const tab = current(owner);
      return observeAction(
        owner,
        tab,
        McpToolName.BrowserWaitFor,
        async (beforeHandoff) => {
          if (owner.browserTest != null) tab.begin();
          await waitForTestUser(owner, tab, beforeHandoff);
          const met = await actions.waitFor(tab, input);
          await waitForTestUser(owner, tab, beforeHandoff);
          const page = await tab.snapshot();
          remember(owner, page);
          return { ...page, tab: tab.kind, met };
        },
        (output) => output.met,
      );
    },

    inspect: (owner: BrowserOwner, ref: string) => actions.inspect(current(owner), ref),
    logs: (owner: BrowserOwner, range: 'open' | 'last') => current(owner).logs(range),

    /** Saved beside the owner's transcript (29 §5.7) and returned for the tool to attach as an image. */
    async screenshot(owner: BrowserOwner, input: { ref?: string; fullPage: boolean }) {
      const tab = current(owner);
      const session = sessionOf(owner);
      const clip = input.ref === undefined ? undefined : await actions.screenshotClip(tab, input.ref);
      const { data } = z.object({ data: z.string() }).parse(
        await tab.cdp('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 70,
          captureBeyondViewport: input.fullPage || clip !== undefined,
          ...(clip === undefined ? {} : { clip }),
        }),
      );
      const dir = ownerDir(owner);
      mkdirSync(dir, { recursive: true });
      const file = `${++session.shots}.jpg`;
      await writeFile(join(dir, file), Buffer.from(data, 'base64'));
      notifyTest(owner);
      return { file, data };
    },

    close,

    /**
     * What a page the owner (an attempt) read in the browser said, the latest reading, or null when it did not read
     * that address with the browser (29 §2.8).
     */
    pageText(ownerId: string, url: string): string | null {
      if (!URL.canParse(url)) return null;
      return sessions.get(ownerId)?.pages.get(pageKey(url)) ?? null;
    },

    /** An attempt's frames in order (29 §8.2); also after it ended or the app restarted. */
    frames(attemptId: string): BrowserFrame[] {
      const index = join(ownerDir({ id: attemptId, filesDir: attemptFilesDir(attemptId) }), FRAMES_INDEX);
      if (!existsSync(index)) return [];
      return readFileSync(index, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => browserFrameSchema.parse(JSON.parse(line)));
    },

    screenshots(attemptId: string): string[] {
      const dir = ownerDir({ id: attemptId, filesDir: attemptFilesDir(attemptId) });
      return existsSync(dir)
        ? readdirSync(dir)
            .filter((file) => /^\d+\.jpg$/.test(file))
            .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        : [];
    },

    /** The path of an attempt's screenshot or frame (29 §5.7); only names the backend gives (ATTEMPT_FILE). */
    attemptFile(attemptId: string, file: string): string {
      if (!ATTEMPT_FILE.test(file)) throw new AppError(ErrorCode.NotFound, 'No such file', { file });
      return join(ownerDir({ id: attemptId, filesDir: attemptFilesDir(attemptId) }), file);
    },

    /**
     * The page check (29 §7): the task's preview (started, queued at the limit), then every page at every viewport
     * in a clean tab. A preview that never started in this worktree, or is no longer configured, cannot run the check
     * (D116); one that ran before and now fails to start is the change's doing, an ordinary failure.
     */
    async pageCheck(request: PageCheckRequest, signal: AbortSignal): Promise<PageCheckResult> {
      const { taskId, nodeId } = request;
      let origin: string;
      try {
        const preview = await previews.start(taskId, { queue: signal });
        if (preview.url === null) throw new Error(`Preview of task ${taskId} is running without an address`);
        origin = preview.url;
      } catch (err) {
        if (signal.aborted) return pageCheckResult([], 'The page check was stopped');
        if (!(err instanceof AppError)) throw err;
        if (err.code === ErrorCode.PreviewNotConfigured) {
          return pageCheckResult([], 'The project has no page preview', {
            reason: PageCheckUnrunnable.PreviewNotConfigured,
            logTail: '',
          });
        }
        if (err.code !== ErrorCode.PreviewStartFailed) throw err;
        const logTail = z.object({ logTail: z.string() }).parse(err.details).logTail;
        const output = `The page preview did not start:\n\n${logTail}`;
        return previews.hasRun(taskId)
          ? pageCheckResult([], output)
          : pageCheckResult([], output, { reason: PageCheckUnrunnable.PreviewNeverStarted, logTail });
      }
      const tab = await openTab({
        host,
        clock,
        log,
        tabId: `check:${nodeId}:${randomUUID()}`,
        kind: BrowserTabKind.Preview,
        partition: `aw-check-${nodeId}`,
        policy: policyFor(request),
        integratedAuthServers: [],
        network: network(),
        site: false,
      });
      previews.acquire(taskId);
      // Forward slashes: the path is also the screenshot's address (29 §7.4).
      const relative = `checks/${nodeId}/${clock.now()}`;
      const dir = join(dataDir, 'runs', taskId, 'browser', relative);
      mkdirSync(dir, { recursive: true });
      const pages: PageCheckResult['pages'] = [];
      try {
        for (const path of request.pages) {
          for (const viewport of request.viewports) {
            if (signal.aborted) return pageCheckResult(pages, 'The page check was stopped');
            const { width, height, mobile } = VIEWPORT_SIZES[viewport];
            await tab.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
            const shot = `${pages.length + 1}.jpg`;
            const page = await checkPage(tab, `${origin}${path}`, dir, shot);
            pages.push({
              path,
              viewport,
              ...page,
              screenshot: page.screenshot === null ? null : `${relative}/${shot}`,
            });
          }
        }
      } finally {
        await tab.close();
        previews.release(taskId);
      }
      return pageCheckResult(pages, pageCheckOutput(pages));
    },

    /**
     * A tab on the window for the user to log in to a website (29 §8.6): the websites' partition keeps the login
     * for the AI's website tabs. Addresses the rules deny go to the system browser, as in every user tab.
     */
    async openLoginTab(url: string): Promise<{ tabId: string }> {
      const tabId = `login:${randomUUID()}`;
      await host.request({
        kind: 'open',
        tabId,
        partition: SITES_PARTITION,
        userFacing: true,
        viewport: null,
        policy: { previewOrigins: [], sites: settings.get('browser.sites') },
        integratedAuthServers: integratedAuthServers(),
        network: network(),
      });
      await host.request({ kind: 'cdp', tabId, method: 'Page.navigate', params: { url } });
      return { tabId };
    },

    /**
     * The user's own tab on the task's preview (29 §8.1), started when needed: placed on the window by the renderer,
     * in the project's partition so logins to the app under test last, holding the preview from idling. Opens the
     * project's first key page; its address and error counts follow by `browser.tab_updated`.
     */
    async openUserTab(taskId: string): Promise<UserTabState> {
      const pending = openingUserTabs.get(taskId);
      if (pending !== undefined) return pending;
      // One preview tab per task: opening it again shows it, following the preview's new origin after a restart.
      const existing = [...userTabs.entries()].find(([, entry]) => entry.taskId === taskId);
      if (existing !== undefined) {
        const [tabId, { tab, projectId }] = existing;
        const preview = await previews.start(taskId);
        return withinDeadline(async (signal) => {
          if (!control.hasPolicy(tabId)) await tab.setPolicy(policyFor({ taskId, projectId }));
          signal.throwIfAborted();
          if (tab.url() === '' || new URL(tab.url()).origin !== preview.url) {
            await navigatePreview(tab, taskId, projects.getRecord(projectId).preview?.pages[0] ?? '/', signal);
          }
          return userTabState(tabId);
        });
      }
      const opening = openNewUserTab(taskId);
      openingUserTabs.set(taskId, opening);
      try {
        return await opening;
      } finally {
        openingUserTabs.delete(taskId);
      }
    },

    /**
     * Opens a path of the task's preview in the user's tab (the preview may have restarted on another port), within
     * BROWSER_READ_TIMEOUT_MS; the tab stays when it times out.
     */
    navigateUserTab(tabId: string, path: string): Promise<void> {
      const { tab, taskId } = userTabOf(tabId);
      return withinDeadline((signal) => navigatePreview(tab, taskId, path, signal));
    },

    /**
     * The UI binds the preview the user is looking at to the assistant's conversation, or unbinds it (15, 29 §8.1):
     * the model cannot, and a message's page parameters grant nothing.
     */
    bindPreview(conversationId: string, selection: { taskId: string; tabId: string } | null): void {
      if (selection === null) {
        void control.revoke(conversationId);
        boundPreviews.delete(conversationId);
        return;
      }
      const entry = userTabs.get(selection.tabId);
      if (entry === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'No user preview tab is open');
      if (entry.taskId !== selection.taskId) {
        throw new AppError(ErrorCode.BrowserNotOpen, 'The preview belongs to another task');
      }
      runningPreviewUrl(entry.taskId);
      if (boundPreviews.get(conversationId) !== selection.tabId) void control.revoke(conversationId);
      boundPreviews.set(conversationId, selection.tabId);
    },

    async setAssistantControl(conversationId: string, projectId: string | null, tabId: string, enabled: boolean) {
      if (!enabled) {
        await control.revoke(conversationId);
        return { enabled: false };
      }
      if (boundPreviews.get(conversationId) !== tabId)
        throw new AppError(ErrorCode.BrowserNotOpen, 'This conversation is not bound to the selected preview');
      const entry = userTabOf(tabId);
      if (projectId !== null && entry.projectId !== projectId)
        throw new AppError(ErrorCode.BrowserNotOpen, 'The preview belongs to a different project');
      await control.enable(conversationId, {
        tab: entry.tab,
        origin: runningPreviewUrl(entry.taskId),
        restore: () => policyFor(entry),
      });
      return { enabled: true };
    },

    assistantControlInfo: control.info,
    async handoffAssistantControl(conversationId: string, tabId: string, manual: boolean) {
      if (boundPreviews.get(conversationId) !== tabId)
        throw new AppError(ErrorCode.BrowserNotOpen, 'This conversation is not bound to the selected preview');
      await control.handoff(conversationId, tabId, manual);
    },

    prepareAssistantAction: control.prepare,
    confirmAssistantAction: control.confirm,

    /**
     * `browser_read`: the bound preview's address, viewport, text and errors, within BROWSER_READ_TIMEOUT_MS. A page
     * the user left, closed or stopped while it settled is not returned.
     */
    async readPreview(conversationId: string) {
      const tabId = boundPreviews.get(conversationId);
      if (tabId === undefined) {
        throw new AppError(ErrorCode.BrowserNotOpen, 'No user-selected preview for this conversation');
      }
      const entry = userTabs.get(tabId);
      if (entry === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'No user preview tab is open');
      const { tab, taskId } = entry;
      control.assertReadable(tabId);
      const version = tab.ownershipVersion();
      runningPreviewUrl(taskId);
      return withinDeadline(async (signal) => {
        const settled = await tab.settle();
        signal.throwIfAborted();
        const snapshot = await tab.snapshot();
        const layout = previews.isFrontend(taskId) ? await frontend.layout(tab) : undefined;
        const selectedElement = layout === undefined ? undefined : frontend.latestElement(tabId, tab);
        signal.throwIfAborted();
        control.assertReadable(tabId);
        if (boundPreviews.get(conversationId) !== tabId || !userTabs.has(tabId) || tab.ownershipVersion() !== version) {
          throw new AppError(ErrorCode.BrowserNotOpen, 'The selected preview changed while reading');
        }
        runningPreviewUrl(taskId);
        return {
          ...snapshot,
          taskId,
          tab: BrowserTabKind.Preview,
          viewport: tab.viewport.preset,
          settled,
          ...(layout === undefined ? {} : { layout }),
          ...(selectedElement === undefined ? {} : { selectedElement }),
          logs: tab.logs('open'),
        };
      });
    },

    /** Desktop fills the tab's place on the window; tablet and mobile emulate their size inside it. */
    async setUserViewport(tabId: string, preset: ViewportPreset): Promise<void> {
      const { tab } = userTabOf(tabId);
      if (preset === 'desktop') await tab.cdp('Emulation.clearDeviceMetricsOverride');
      else {
        const { width, height, mobile } = VIEWPORT_SIZES[preset];
        await tab.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile });
      }
      tab.viewport.preset = preset;
      events.publish({ type: ServerEventType.BrowserTabUpdated, data: userTabState(tabId) });
    },

    closeUserTab,

    async pickFrontendElement(tabId: string, requestId: string, cancel: boolean) {
      if (cancel) {
        frontend.cancel(tabId, requestId);
        return null;
      }
      const { tab, taskId } = userTabOf(tabId);
      if (!previews.isFrontend(taskId))
        throw new AppError(ErrorCode.StateTransitionInvalid, 'This tab is not a frontend task preview');
      requireFrontendPage(taskId, tab);
      return withinDeadline((signal) =>
        frontend.pick(tabId, tab, requestId, signal, () => {
          if (userTabs.has(tabId))
            events.publish({ type: ServerEventType.BrowserTabUpdated, data: userTabState(tabId) });
        }),
      );
    },

    async captureFrontendRound(taskId: string, page: NonNullable<RequestChangesRequest['page']>) {
      const { tab, taskId: owner } = userTabOf(page.tabId);
      if (owner !== taskId) throw new AppError(ErrorCode.ValidationFailed, 'The preview belongs to another task');
      requireFrontendPage(taskId, tab);
      const annotations = (page.annotations ?? []).map(({ elementId, note }) => {
        const element = frontend.getElement(page.tabId, elementId);
        if (element === undefined)
          throw new AppError(ErrorCode.ValidationFailed, 'Select the annotated element again', {
            issues: [
              { path: ['page', 'annotations'], message: 'The selected element is no longer in this preview session' },
            ],
          });
        return { element, note };
      });
      const before = await withinDeadline((signal) => frontend.capture(taskId, tab, signal));
      return { annotations, before };
    },

    /**
     * What the user's preview tab shows, written into their change request (29 §2.3): its path and viewport, the
     * current page's console errors and failed requests. The tab must be on this task's preview.
     */
    pageNote(taskId: string, tabId: string): string {
      const { tab, taskId: owner } = userTabOf(tabId);
      if (owner !== taskId) {
        throw new AppError(ErrorCode.ValidationFailed, "The tab shows another task's preview", {
          issues: [{ path: ['page', 'tabId'], message: 'not a preview tab of this task' }],
        });
      }
      const url = tab.url();
      const { width, height } = VIEWPORT_SIZES[tab.viewport.preset];
      const { errors, requests } = tab.pageLogs();
      return [
        `The user was looking at ${url === '' ? '/' : new URL(url).pathname + new URL(url).search} of the preview (${tab.viewport.preset}, ${width}×${height}).`,
        errors.length === 0
          ? 'Console errors: none.'
          : [
              'Console errors:',
              ...errors.map((e) => `- ${e.message}${e.source === null ? '' : ` (${e.source})`}`),
            ].join('\n'),
        requests.length === 0
          ? 'Failed requests: none.'
          : ['Failed requests:', ...requests.map((r) => `- ${r.method} ${r.url} → ${r.status ?? r.error}`)].join('\n'),
      ].join('\n');
    },

    userTabLogs(tabId: string) {
      const { errors, requests } = userTabOf(tabId).tab.pageLogs();
      return {
        errors,
        requests: requests.map(({ method, url, status, error }) => ({ method, url, status, error })),
      };
    },

    siteLogins,

    /** Logs out of a website: its cookies and its pages' storage in the websites' partition go. */
    async clearSiteLogin(siteHost: string): Promise<{ hosts: string[] }> {
      await withSitesTab(async (cdp) => {
        const { cookies } = cookiesSchema.parse(await cdp('Network.getAllCookies'));
        for (const cookie of cookies.filter((c) => hostOfCookie(c.domain) === siteHost)) {
          await cdp('Network.deleteCookies', { name: cookie.name, domain: cookie.domain, path: cookie.path });
        }
        for (const scheme of ['http', 'https']) {
          await cdp('Storage.clearDataForOrigin', {
            origin: `${scheme}://${siteHost}`,
            storageTypes: 'local_storage,indexeddb,cache_storage,service_workers',
          });
        }
      });
      return siteLogins();
    },

    async closeAll(): Promise<void> {
      for (const abort of waiting) abort.abort(new AppError(ErrorCode.BrowserNotOpen, 'The browser is closing'));
      // An open that fails reports it to its caller; closing waits for it, then for the other tabs.
      await Promise.allSettled([...openingUserTabs.values()]);
      unsubscribeHost();
      await Promise.all([...sessions.keys()].map((id) => close(id)));
      await Promise.all([...userTabs.keys()].map((id) => closeUserTab(id)));
    },
  };
}

export type BrowserService = ReturnType<typeof createBrowserService>;
