import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  ATTEMPT_STATUSES,
  AttemptStatus,
  type BrowserActionOutput,
  type BrowserKey,
  type BrowserPage,
  type BrowserPolicy,
  BrowserTabKind,
  ErrorCode,
  PreviewState,
  ServerEventType,
  urlAccess,
  VIEWPORT_SIZES,
  type ViewportPreset,
} from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { PreviewsService } from '../previews/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createActions } from './browser.actions.ts';
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
};

/** Who uses the browser (an attempt, 29 §5.3) and where its screenshots go (beside its transcript, 29 §5.7). */
export type BrowserOwner = { id: string; taskId: string | null; projectId: string | null; filesDir: string };

type Session = { owner: BrowserOwner; tabs: Partial<Record<BrowserTabKind, Tab>>; current: Tab | null; shots: number };

/** Host or path fragments of login pages, besides `browser.loginUrlPatterns` (29 §5.4). */
const LOGIN_HINTS = ['login', 'signin', 'sign-in', 'sso', 'cas', 'oauth'];
const ENDED = new Set<string>(
  ATTEMPT_STATUSES.filter((s) => s !== AttemptStatus.Starting && s !== AttemptStatus.Running),
);

/** The AI's browser (29 §5–§6): an owner's two tabs, what they may open, and the tools' actions on them. */
export function createBrowserService({ host, clock, log, events, settings, projects, previews }: BrowserServiceDeps) {
  const sessions = new Map<string, Session>();
  const actions = createActions(clock);

  function policyFor(owner: BrowserOwner): BrowserPolicy {
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
    const session: Session = { owner, tabs: {}, current: null, shots: 0 };
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
      partition: kind === BrowserTabKind.Preview ? `aw-attempt-${owner.id}` : 'persist:aw-sites',
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

  /** Runs an action on the current tab and reports what it did to the page (29 §6). */
  async function act(owner: BrowserOwner, run: (tab: Tab) => Promise<void>): Promise<BrowserActionOutput> {
    const tab = current(owner);
    tab.begin();
    await run(tab);
    return tab.result(await tab.settle());
  }

  async function close(ownerId: string): Promise<void> {
    const session = sessions.get(ownerId);
    if (session === undefined) return;
    sessions.delete(ownerId);
    for (const tab of Object.values(session.tabs)) await tab.close();
    if (session.tabs.preview !== undefined && session.owner.taskId !== null) previews.release(session.owner.taskId);
  }

  events.subscribe((event) => {
    // An attempt's tabs end with it; the browser module does not depend on attempts (29 §11).
    if (event.type === ServerEventType.AttemptUpdated && ENDED.has(event.data.attempt.status)) {
      close(event.data.attempt.id).catch((err: unknown) => log.error({ err }, 'browser tabs close failed'));
    }
    // A preview restarted on another port: the tabs of its task follow its origin.
    if (event.type === ServerEventType.PreviewUpdated && event.data.state === PreviewState.Running) {
      for (const session of sessions.values()) {
        if (session.owner.taskId !== event.data.taskId) continue;
        const policy = policyFor(session.owner);
        for (const tab of Object.values(session.tabs)) {
          tab.setPolicy(policy).catch((err: unknown) => log.error({ err }, 'browser policy update failed'));
        }
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
      const output = await tab.result(await tab.settle());
      if (access.tab === BrowserTabKind.Site && (await loginPage(tab, output.url))) {
        throw new AppError(ErrorCode.BrowserLoginRequired, 'The website asks to log in', { url: output.url });
      }
      return output;
    },

    async snapshot(owner: BrowserOwner): Promise<BrowserPage> {
      const tab = current(owner);
      return { ...(await tab.snapshot()), tab: tab.kind };
    },

    click: (owner: BrowserOwner, ref: string) => act(owner, (tab) => actions.click(tab, ref)),
    type: (owner: BrowserOwner, ref: string, input: { text: string; clear: boolean; submit: boolean }) =>
      act(owner, (tab) => actions.type(tab, ref, input)),
    select: (owner: BrowserOwner, ref: string, values: readonly string[]) =>
      act(owner, (tab) => actions.select(tab, ref, values)),
    press: (owner: BrowserOwner, key: BrowserKey) => act(owner, (tab) => actions.press(tab, key)),

    viewport: (owner: BrowserOwner, preset: ViewportPreset) =>
      act(owner, async (tab) => {
        const { width, height, mobile } = VIEWPORT_SIZES[preset];
        await tab.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        tab.viewport.preset = preset;
      }),

    async waitFor(owner: BrowserOwner, input: { text: string; gone: boolean; timeoutMs: number }) {
      const tab = current(owner);
      const met = await actions.waitFor(tab, input);
      return { ...(await tab.snapshot()), tab: tab.kind, met };
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
      const dir = join(owner.filesDir, 'browser', owner.id);
      mkdirSync(dir, { recursive: true });
      const file = `${++session.shots}.jpg`;
      await writeFile(join(dir, file), Buffer.from(data, 'base64'));
      return { file, data };
    },

    close,

    async closeAll(): Promise<void> {
      await Promise.all([...sessions.keys()].map((id) => close(id)));
    },
  };
}

export type BrowserService = ReturnType<typeof createBrowserService>;
