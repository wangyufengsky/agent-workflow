import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AcceptanceCheckKind,
  AppError,
  ATTEMPT_STATUSES,
  AttemptStatus,
  BROWSER_FRAME_QUALITY,
  BROWSER_FRAME_WIDTH,
  type BrowserActionOutput,
  type BrowserFrame,
  type BrowserKey,
  type BrowserPage,
  type BrowserPolicy,
  BrowserTabKind,
  browserFrameSchema,
  ErrorCode,
  McpToolName,
  PAGE_CHECK_SHOT_MAX_HEIGHT,
  PageCheckUnrunnable,
  PreviewState,
  ServerEventType,
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
import { type PageCheckPage, type PageCheckResult, pageCheckOutput, pageCheckVerdict } from './browser.check.ts';
import type { BrowserHost } from './browser.host.ts';
import { openTab, type Tab } from './browser.tab.ts';

export type BrowserServiceDeps = {
  host: BrowserHost;
  clock: Clock;
  log: Logger;
  events: EventBus;
  settings: SettingsService;
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
export type BrowserOwner = { id: string; taskId: string | null; projectId: string | null; filesDir: string };

type Session = {
  owner: BrowserOwner;
  tabs: Partial<Record<BrowserTabKind, Tab>>;
  current: Tab | null;
  shots: number;
  frames: number;
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
const ENDED = new Set<string>(
  ATTEMPT_STATUSES.filter((s) => s !== AttemptStatus.Starting && s !== AttemptStatus.Running),
);

const navigateSchema = z.object({ errorText: z.string().optional() });
const visualViewportSchema = z.object({
  cssVisualViewport: z.object({
    pageX: z.number(),
    pageY: z.number(),
    clientWidth: z.number(),
    clientHeight: z.number(),
  }),
});
/** An attempt's frames, one JSON line each, beside their images (29 §5.7). */
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
  settings,
  projects,
  previews,
  dataDir,
  attemptFilesDir,
}: BrowserServiceDeps) {
  const sessions = new Map<string, Session>();
  /** The user's own preview tabs (29 §8.1), by tab id. */
  const userTabs = new Map<string, { tab: Tab; taskId: string; projectId: string }>();
  const actions = createActions(clock);

  function policyFor(owner: Pick<BrowserOwner, 'taskId' | 'projectId'>): BrowserPolicy {
    const preview = owner.taskId === null ? null : previews.get(owner.taskId);
    const extra = owner.projectId === null ? [] : (projects.getRecord(owner.projectId).preview?.extraOrigins ?? []);
    return {
      previewOrigins: preview?.url === null || preview?.url === undefined ? [] : [preview.url, ...extra],
      sites: settings.get('browser.sites'),
    };
  }

  function sessionOf(owner: BrowserOwner): Session {
    const existing = sessions.get(owner.id);
    if (existing !== undefined) return existing;
    const session: Session = { owner, tabs: {}, current: null, shots: 0, frames: 0 };
    sessions.set(owner.id, session);
    return session;
  }

  function current(owner: BrowserOwner): Tab {
    const tab = sessions.get(owner.id)?.current;
    if (tab === null || tab === undefined) {
      throw new AppError(ErrorCode.ValidationFailed, 'No page is open: call browser_open first');
    }
    return tab;
  }

  async function tabFor(session: Session, kind: BrowserTabKind): Promise<Tab> {
    const existing = session.tabs[kind];
    if (existing !== undefined) return existing;
    const { owner } = session;
    const tab = await openTab({
      host,
      clock,
      log,
      tabId: `${owner.id}:${kind}`,
      kind,
      // The preview tab starts clean for each attempt; websites share the user's logins (29 §5.3).
      partition: kind === BrowserTabKind.Preview ? `aw-attempt-${owner.id}` : SITES_PARTITION,
      policy: policyFor(owner),
      site: kind === BrowserTabKind.Site,
    });
    session.tabs[kind] = tab;
    if (kind === BrowserTabKind.Preview && owner.taskId !== null) previews.acquire(owner.taskId);
    return tab;
  }

  async function loginPage(tab: Tab, url: string): Promise<boolean> {
    const { hostname, pathname } = new URL(url);
    const where = `${hostname}${pathname}`.toLowerCase();
    if (
      [...LOGIN_HINTS, ...settings.get('browser.loginUrlPatterns')].some((hint) => where.includes(hint.toLowerCase()))
    ) {
      return true;
    }
    return (await tab.evaluate('document.querySelectorAll("input[type=password]").length')) === 1;
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

  /** Runs an action on the current tab and reports what it did to the page (29 §6), leaving a frame. */
  async function act(
    owner: BrowserOwner,
    tool: ActingTool,
    run: (tab: Tab) => Promise<void>,
  ): Promise<BrowserActionOutput> {
    const tab = current(owner);
    tab.begin();
    await run(tab);
    const output = await tab.result(await tab.settle());
    return { ...output, frame: await frame(owner, tab, tool, output.url) };
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
    for (const tab of Object.values(session.tabs)) await tab.close();
    if (session.tabs.preview !== undefined && session.owner.taskId !== null) previews.release(session.owner.taskId);
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

  function userTabOf(tabId: string) {
    const entry = userTabs.get(tabId);
    if (entry === undefined) throw new AppError(ErrorCode.NotFound, `No preview tab ${tabId}`, { tabId });
    return entry;
  }

  function userTabState(tabId: string): UserTabState {
    const { tab, taskId } = userTabOf(tabId);
    return { tabId, taskId, url: tab.url(), viewport: tab.viewport.preset, ...tab.pageCounts() };
  }

  async function closeUserTab(tabId: string): Promise<void> {
    const entry = userTabs.get(tabId);
    if (entry === undefined) {
      // A login tab (29 §8.6): only the host has it.
      await host.request({ kind: 'close', tabId });
      return;
    }
    userTabs.delete(tabId);
    await entry.tab.close();
    previews.release(entry.taskId);
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
        tab.setPolicy(policyFor(owner)).catch((err: unknown) => log.error({ err }, 'browser policy update failed'));
      }
    }
  });

  return {
    /**
     * `browser_open` (29 §6): a path starting with / opens in the task's preview (started first when needed), a full
     * address in the preview tab or the website tab by the policy.
     */
    async open(owner: BrowserOwner, url: string): Promise<BrowserActionOutput> {
      let target = url;
      if (url.startsWith('/')) {
        if (owner.taskId === null) {
          throw new AppError(ErrorCode.ValidationFailed, 'Only tasks have a page preview: give a full address', {
            url,
          });
        }
        const preview = await previews.start(owner.taskId);
        target = `${preview.url}${url}`;
      }
      const session = sessionOf(owner);
      // Normalized here, as the policy expects (shared has no URL parser).
      const normalized = URL.canParse(target) ? new URL(target).href : target;
      const access = urlAccess(normalized, policyFor(owner));
      if (access === null) {
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'No website rule allows this address', {
          host: URL.canParse(target) ? new URL(target).host : target,
        });
      }
      const tab = await tabFor(session, access.tab);
      session.current = tab;
      tab.begin();
      await tab.cdp('Page.navigate', { url: normalized });
      const settled = await tab.result(await tab.settle());
      const output = { ...settled, frame: await frame(owner, tab, McpToolName.BrowserOpen, settled.url) };
      if (access.tab === BrowserTabKind.Site && (await loginPage(tab, output.url))) {
        throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: output.url });
      }
      return output;
    },

    async snapshot(owner: BrowserOwner): Promise<BrowserPage> {
      const tab = current(owner);
      return { ...(await tab.snapshot()), tab: tab.kind };
    },

    click: (owner: BrowserOwner, ref: string) => act(owner, McpToolName.BrowserClick, (tab) => actions.click(tab, ref)),
    type: (owner: BrowserOwner, ref: string, input: { text: string; clear: boolean; submit: boolean }) =>
      act(owner, McpToolName.BrowserType, (tab) => actions.type(tab, ref, input)),
    select: (owner: BrowserOwner, ref: string, values: readonly string[]) =>
      act(owner, McpToolName.BrowserSelect, (tab) => actions.select(tab, ref, values)),
    press: (owner: BrowserOwner, key: BrowserKey) =>
      act(owner, McpToolName.BrowserPress, (tab) => actions.press(tab, key)),

    viewport: (owner: BrowserOwner, preset: ViewportPreset) =>
      act(owner, McpToolName.BrowserViewport, async (tab) => {
        const { width, height, mobile } = VIEWPORT_SIZES[preset];
        await tab.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        tab.viewport.preset = preset;
      }),

    async waitFor(owner: BrowserOwner, input: { text: string; gone: boolean; timeoutMs: number }) {
      const tab = current(owner);
      const met = await actions.waitFor(tab, input);
      const page = await tab.snapshot();
      return { ...page, tab: tab.kind, met, frame: await frame(owner, tab, McpToolName.BrowserWaitFor, page.url) };
    },

    inspect: (owner: BrowserOwner, ref: string) => actions.inspect(current(owner), ref),
    logs: (owner: BrowserOwner, range: 'open' | 'last') => current(owner).logs(range),

    /** Saved beside the owner's transcript (29 §5.7) and returned for the tool to attach as an image. */
    async screenshot(owner: BrowserOwner, input: { ref?: string; fullPage: boolean }) {
      const tab = current(owner);
      const session = sessionOf(owner);
      let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
      if (input.ref !== undefined) {
        const { box } = await actions.inspect(tab, input.ref);
        if (box !== null) clip = { ...box, scale: 1 };
      }
      const { data } = z.object({ data: z.string() }).parse(
        await tab.cdp('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 70,
          captureBeyondViewport: input.fullPage,
          ...(clip === undefined ? {} : { clip }),
        }),
      );
      const dir = ownerDir(owner);
      mkdirSync(dir, { recursive: true });
      const file = `${++session.shots}.jpg`;
      await writeFile(join(dir, file), Buffer.from(data, 'base64'));
      return { file, data };
    },

    close,

    /** An attempt's frames in order (29 §8.2); also after it ended or the app restarted. */
    frames(attemptId: string): BrowserFrame[] {
      const index = join(ownerDir({ id: attemptId, filesDir: attemptFilesDir(attemptId) }), FRAMES_INDEX);
      if (!existsSync(index)) return [];
      return readFileSync(index, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => browserFrameSchema.parse(JSON.parse(line)));
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
      const preview = await previews.start(taskId);
      const projectId = previews.projectOf(taskId);
      const tabId = `preview:${randomUUID()}`;
      const tab = await openTab({
        host,
        clock,
        log,
        tabId,
        kind: BrowserTabKind.Preview,
        partition: `persist:aw-preview-${projectId}`,
        policy: policyFor({ taskId, projectId }),
        site: false,
        userFacing: true,
      });
      userTabs.set(tabId, { tab, taskId, projectId });
      previews.acquire(taskId);
      tab.onChange(() => events.publish({ type: ServerEventType.BrowserTabUpdated, data: userTabState(tabId) }));
      const first = projects.getRecord(projectId).preview?.pages[0] ?? '/';
      await tab.cdp('Page.navigate', { url: `${preview.url}${first}` });
      return userTabState(tabId);
    },

    /** Opens a path of the task's preview in the user's tab (the preview may have restarted on another port). */
    async navigateUserTab(tabId: string, path: string): Promise<void> {
      const { tab, taskId } = userTabOf(tabId);
      const preview = await previews.start(taskId);
      await tab.cdp('Page.navigate', { url: `${preview.url}${path}` });
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
      await Promise.all([...sessions.keys()].map((id) => close(id)));
      await Promise.all([...userTabs.keys()].map((id) => closeUserTab(id)));
    },
  };
}

export type BrowserService = ReturnType<typeof createBrowserService>;
