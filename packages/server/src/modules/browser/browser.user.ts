import { randomUUID } from 'node:crypto';
import {
  AppError,
  type BrowserPolicy,
  BrowserTabKind,
  ErrorCode,
  PreviewState,
  ServerEventType,
  TaskStatus,
  type UserPreviewTab,
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
import type { BrowserHost } from './browser.host.ts';
import { openTab, type Tab } from './browser.tab.ts';

type UserTab = { taskId: string; projectId: string; origin: string; tab: Tab };
type PreviewSelection = { taskId: string; tabId: string };
type Deps = {
  host: BrowserHost;
  clock: Clock;
  log: Logger;
  events: EventBus;
  previews: PreviewsService;
  projects: ProjectsService;
  settings: SettingsService;
};

/** 用户预览与尝试页严格分开；助手只读由界面明确关联的用户页。 */
export function createUserBrowser({ host, clock, log, events, previews, projects, settings }: Deps) {
  const tabs = new Map<string, UserTab>();
  const opening = new Map<string, Promise<UserPreviewTab>>();
  const selected = new Map<string, string>();

  function requireTab(tabId: string): UserTab {
    const tab = tabs.get(tabId);
    if (tab === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'No user preview tab is open');
    return tab;
  }
  function previewUrl(taskId: string): string {
    const preview = previews.get(taskId);
    if (preview.state !== PreviewState.Running || preview.url === null) {
      throw new AppError(ErrorCode.BrowserNotOpen, 'The selected task preview is not running', { taskId });
    }
    return preview.url;
  }
  function policyFor(taskId: string, projectId: string): BrowserPolicy {
    return {
      previewOrigins: [previewUrl(taskId), ...(projects.getRecord(projectId).preview?.extraOrigins ?? [])],
      sites: settings.get('browser.sites'),
    };
  }
  function forget(tabId: string): UserTab | undefined {
    const entry = tabs.get(tabId);
    if (entry === undefined) return undefined;
    tabs.delete(tabId);
    unbind(tabId);
    previews.release(entry.taskId);
    return entry;
  }
  function unbind(tabId: string): void {
    for (const [conversationId, selection] of selected) {
      if (selection === tabId) selected.delete(conversationId);
    }
  }
  async function close(tabId: string): Promise<void> {
    const entry = forget(tabId);
    if (entry !== undefined) await entry.tab.close();
  }
  async function navigate(tabId: string, path: string): Promise<void> {
    const entry = requireTab(tabId);
    const { taskId, tab } = entry;
    const origin = previewUrl(taskId);
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new AppError(ErrorCode.ValidationFailed, 'Preview navigation needs a local path');
    const result = z
      .object({ errorText: z.string().optional() })
      .parse(await tab.cdp('Page.navigate', { url: url.href }));
    if (result.errorText !== undefined) {
      throw new AppError(ErrorCode.BrowserReadFailed, 'The preview page could not be loaded', {
        reason: result.errorText,
      });
    }
    entry.origin = origin;
  }
  async function openNew(taskId: string): Promise<UserPreviewTab> {
    await previews.start(taskId);
    const projectId = previews.projectOf(taskId);
    const tab = await openTab({
      host,
      clock,
      log,
      tabId: `user-preview:${randomUUID()}`,
      kind: BrowserTabKind.Preview,
      partition: `persist:aw-preview-${projectId}`,
      policy: policyFor(taskId, projectId),
      site: false,
      userFacing: true,
    });
    tabs.set(tab.tabId, { taskId, projectId, origin: previewUrl(taskId), tab });
    previews.acquire(taskId);
    try {
      await navigate(tab.tabId, '/');
      return { tabId: tab.tabId, viewport: tab.viewport.preset };
    } catch (err) {
      await close(tab.tabId);
      throw err;
    }
  }

  events.subscribe((event) => {
    if (
      event.type === ServerEventType.TaskUpdated &&
      (event.data.status === TaskStatus.Completed || event.data.status === TaskStatus.Cancelled)
    ) {
      for (const [tabId, tab] of tabs) {
        if (tab.taskId === event.data.id)
          close(tabId).catch((err: unknown) => log.error({ err }, 'user preview close failed'));
      }
    }
    if (event.type === ServerEventType.PreviewUpdated && event.data.state === PreviewState.Running) {
      for (const tab of tabs.values()) {
        if (tab.taskId === event.data.taskId) {
          tab.tab
            .setPolicy(policyFor(tab.taskId, tab.projectId))
            .catch((err: unknown) => log.error({ err }, 'user preview policy update failed'));
        }
      }
    }
    if (
      event.type === ServerEventType.PreviewUpdated &&
      (event.data.state === PreviewState.Stopped || event.data.state === PreviewState.Failed)
    ) {
      for (const [tabId, tab] of tabs) if (tab.taskId === event.data.taskId) unbind(tabId);
    }
  });
  host.onEvent((event) => {
    if (event.type === 'browser.gone') forget(event.tabId);
  });

  return {
    owns: (tabId: string) => tabs.has(tabId),
    async open(taskId: string) {
      const existing = [...tabs.values()].find((tab) => tab.taskId === taskId);
      if (existing !== undefined) {
        await previews.start(taskId);
        await existing.tab.setPolicy(policyFor(taskId, existing.projectId));
        if (previewUrl(taskId) !== existing.origin) await navigate(existing.tab.tabId, '/');
        return { tabId: existing.tab.tabId, viewport: existing.tab.viewport.preset };
      }
      const pending = opening.get(taskId);
      if (pending !== undefined) return pending;
      const result = openNew(taskId);
      opening.set(taskId, result);
      try {
        return await result;
      } finally {
        opening.delete(taskId);
      }
    },
    navigate,
    close,
    bind(conversationId: string, selection: PreviewSelection | null): void {
      if (selection === null) {
        selected.delete(conversationId);
        return;
      }
      const entry = requireTab(selection.tabId);
      if (entry.taskId !== selection.taskId)
        throw new AppError(ErrorCode.BrowserNotOpen, 'The preview belongs to another task');
      previewUrl(entry.taskId);
      selected.set(conversationId, selection.tabId);
    },
    async read(conversationId: string) {
      const tabId = selected.get(conversationId);
      if (tabId === undefined)
        throw new AppError(ErrorCode.BrowserNotOpen, 'No user-selected preview for this conversation');
      const { tab, taskId } = requireTab(tabId);
      previewUrl(taskId);
      const settled = await tab.settle();
      const snapshot = await tab.snapshot();
      // 稳定等待期间用户可能切走、关闭或停掉预览；不再返回已经失去关联的页面。
      if (selected.get(conversationId) !== tabId || !tabs.has(tabId)) {
        throw new AppError(ErrorCode.BrowserNotOpen, 'The selected preview changed while reading');
      }
      previewUrl(taskId);
      return {
        ...snapshot,
        taskId,
        tab: BrowserTabKind.Preview,
        viewport: tab.viewport.preset,
        settled,
        logs: tab.logs('open'),
      };
    },
    async viewport(tabId: string, preset: ViewportPreset): Promise<void> {
      const { tab } = requireTab(tabId);
      await tab.cdp('Emulation.setDeviceMetricsOverride', { ...VIEWPORT_SIZES[preset], deviceScaleFactor: 1 });
      tab.viewport.preset = preset;
    },
    async closeAll(): Promise<void> {
      // 打开失败已经由原调用报告；收尾仍须等它结束并关闭其他页签。
      await Promise.allSettled([...opening.values()]);
      await Promise.all([...tabs.keys()].map(close));
    },
  };
}
