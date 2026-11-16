import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  type BrowserPortEvent,
  ErrorCode,
  type FrontendElement,
  type FrontendRound,
  frontendElementSchema,
  frontendPageLayoutSchema,
} from '@aw/shared';
import { z } from 'zod';
import type { BrowserHost } from './browser.host.ts';
import type { Tab } from './browser.tab.ts';

const highlighted = {
  showInfo: true,
  contentColor: { r: 85, g: 122, b: 255, a: 0.26 },
  borderColor: { r: 85, g: 122, b: 255, a: 0.95 },
};
const elementPick = z.object({ backendNodeId: z.number() });
const resolved = z.object({ object: z.object({ objectId: z.string() }) });
const elementFacts = frontendElementSchema.omit({ id: true, path: true, viewport: true });
const readLayout = `({
  width: window.innerWidth,
  height: window.innerHeight,
  scrollWidth: document.documentElement.scrollWidth
})`;
const readElement = `function () {
  const target = (this.nodeType === 1 ? this : this.parentElement);
  const node = target.closest('button, a, input, select, textarea, [role="button"]') ?? target;
  const tag = node.localName;
  const label = node.getAttribute('aria-label') ?? node.getAttribute('placeholder') ?? node.innerText ?? '';
  const r = node.getBoundingClientRect();
  const css = getComputedStyle(node);
  const parent = node.parentElement === null ? css : getComputedStyle(node.parentElement);
  const classes = [...node.classList].slice(0, 3).map((name) => '.' + CSS.escape(name)).join('');
  const locator = node.id ? '#' + CSS.escape(node.id) : tag + classes;
  return {
    tag: tag.slice(0, 40),
    label: label.replace(/\\s+/g, ' ').trim().slice(0, 160),
    locator: locator.slice(0, 200),
    box: { x: r.x, y: r.y, width: r.width, height: r.height },
    layout: ${readLayout},
    styles: {
      display: css.display, position: css.position, fontSize: css.fontSize, lineHeight: css.lineHeight,
      color: css.color, backgroundColor: css.backgroundColor, padding: css.padding,
      margin: css.margin, gap: css.gap, overflow: css.overflow,
      parentDisplay: parent.display, parentDirection: parent.flexDirection, parentGap: parent.gap,
    },
  };
}`;

const pagePath = (tab: Tab): string => new URL(tab.url()).pathname.slice(0, 500);
type PendingPick = { id: string; done: PromiseWithResolvers<number | null>; abort: () => void; armed: boolean };

export function createFrontendPreview(host: BrowserHost, dataDir: string) {
  const pending = new Map<string, PendingPick>();
  const selected = new Map<string, Map<string, { element: FrontendElement; document: number }>>();

  function handle(event: BrowserPortEvent): void {
    if (event.type !== 'browser.cdpEvent') return;
    const pick = pending.get(event.tabId);
    if (pick === undefined) return;
    if (event.method === 'Overlay.inspectNodeRequested') {
      pick.done.resolve(elementPick.parse(event.params).backendNodeId);
    } else if (
      event.method === 'Overlay.inspectModeCanceled' ||
      (event.method === 'Page.frameNavigated' &&
        z.object({ frame: z.object({ parentId: z.string().optional() }) }).parse(event.params).frame.parentId ===
          undefined)
    ) {
      pick.done.resolve(null);
    }
  }

  async function pick(tabId: string, tab: Tab, requestId: string, signal: AbortSignal, changed: () => void) {
    if (pending.has(tabId))
      throw new AppError(ErrorCode.StateTransitionInvalid, 'A page selection is already in progress');
    const done = Promise.withResolvers<number | null>();
    const abort = () => done.resolve(null);
    const current: PendingPick = { id: requestId, done, abort, armed: false };
    pending.set(tabId, current);
    signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = host.onEvent(handle);
    try {
      await tab.cdp('DOM.enable');
      await tab.cdp('Overlay.enable');
      signal.throwIfAborted();
      await tab.cdp('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: highlighted });
      current.armed = true;
      changed();
      const backendNodeId = await done.promise;
      if (backendNodeId === null) return null;
      const { object } = resolved.parse(await tab.cdp('DOM.resolveNode', { backendNodeId }));
      let facts: z.infer<typeof elementFacts>;
      try {
        const response = z.object({ result: z.object({ value: elementFacts }) }).parse(
          await tab.cdp('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: readElement,
            returnByValue: true,
          }),
        );
        facts = response.result.value;
      } finally {
        if (pending.has(tabId)) await tab.cdp('Runtime.releaseObject', { objectId: object.objectId });
      }
      signal.throwIfAborted();
      const element = {
        id: randomUUID(),
        path: pagePath(tab),
        viewport: tab.viewport.preset,
        ...facts,
      };
      const elements = selected.get(tabId) ?? new Map<string, { element: FrontendElement; document: number }>();
      if (elements.size >= 64) {
        const oldest = elements.keys().next().value;
        if (oldest !== undefined) elements.delete(oldest);
      }
      elements.set(element.id, { element, document: tab.documentVersion() });
      selected.set(tabId, elements);
      return element;
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
      // A closed tab already lost the overlay and is no longer reachable.
      if (pending.get(tabId)?.id === requestId) {
        try {
          await tab.cdp('Overlay.setInspectMode', { mode: 'none', highlightConfig: highlighted });
          await tab.cdp('Overlay.hideHighlight');
        } finally {
          pending.delete(tabId);
          changed();
        }
      }
    }
  }

  return {
    pick,
    isArmed: (tabId: string): boolean => pending.get(tabId)?.armed === true,
    cancel(tabId: string, requestId: string): void {
      const pick = pending.get(tabId);
      if (pick?.id === requestId) pick.abort();
    },
    forget(tabId: string): void {
      pending.get(tabId)?.abort();
      pending.delete(tabId);
      selected.delete(tabId);
    },
    getElement: (tabId: string, id: string) => selected.get(tabId)?.get(id)?.element,
    latestElement: (tabId: string, tab: Tab) =>
      [...(selected.get(tabId)?.values() ?? [])].findLast(
        ({ element, document }) =>
          document === tab.documentVersion() &&
          element.path === pagePath(tab) &&
          element.viewport === tab.viewport.preset,
      )?.element,
    layout: async (tab: Tab) => frontendPageLayoutSchema.parse(await tab.evaluate(readLayout)),
    async capture(taskId: string, tab: Tab, signal: AbortSignal): Promise<NonNullable<FrontendRound['before']>> {
      const path = pagePath(tab);
      const viewport = tab.viewport.preset;
      const { cssVisualViewport: v } = z
        .object({
          cssVisualViewport: z.object({
            pageX: z.number(),
            pageY: z.number(),
            clientWidth: z.number().positive(),
            clientHeight: z.number().positive(),
          }),
        })
        .parse(await tab.cdp('Page.getLayoutMetrics'));
      const { data } = z.object({ data: z.string() }).parse(
        await tab.cdp('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 68,
          clip: {
            x: v.pageX,
            y: v.pageY,
            width: v.clientWidth,
            height: v.clientHeight,
            scale: Math.min(1, 960 / v.clientWidth),
          },
        }),
      );
      if (path !== pagePath(tab) || viewport !== tab.viewport.preset)
        throw new AppError(ErrorCode.BrowserReadFailed, 'The preview changed while capturing the round');
      signal.throwIfAborted();
      const name = `${randomUUID()}.jpg`;
      const dir = join(dataDir, 'runs', taskId, 'browser', 'frontend');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), Buffer.from(data, 'base64'));
      return { file: `frontend/${name}`, path, viewport };
    },
  };
}
