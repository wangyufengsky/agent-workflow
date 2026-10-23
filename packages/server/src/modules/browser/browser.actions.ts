import { AppError, BROWSER_ACTION_TIMEOUT_MS, BrowserActionFailure, type BrowserKey, ErrorCode } from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { Tab } from './browser.tab.ts';

const objectSchema = z.object({ object: z.object({ objectId: z.string() }) });
const callSchema = z.object({ result: z.object({ value: z.unknown().optional() }) });
const quadsSchema = z.object({ quads: z.array(z.array(z.number())) });
const hitSchema = z.object({ backendNodeId: z.number() });

type Point = { x: number; y: number };

function failed(reason: BrowserActionFailure, ref: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorCode.BrowserActionFailed, `Cannot act on ${ref}: ${reason}`, { reason, ref, ...details });
}

/** Key definitions CDP needs to type each key `browser_press` accepts (DOM `key` / `code` / key code). */
const KEYS: Record<BrowserKey, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

/** The action layer (29 §5.5): locate, scroll into view, wait until stable and hittable, then act. */
export function createActions(clock: Clock) {
  async function resolve(tab: Tab, ref: string): Promise<{ node: number; objectId: string }> {
    const node = tab.refOf(ref);
    try {
      const { object } = objectSchema.parse(await tab.cdp('DOM.resolveNode', { backendNodeId: node }));
      return { node, objectId: object.objectId };
    } catch (err) {
      // Translate: the node behind the ref left the document.
      if (err instanceof AppError) throw err;
      throw failed(BrowserActionFailure.Detached, ref);
    }
  }

  async function call(tab: Tab, objectId: string, fn: string, args: unknown[] = []): Promise<unknown> {
    const response = await tab.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: fn,
      arguments: args.map((a) => (typeof a === 'object' && a !== null && 'objectId' in a ? a : { value: a })),
      returnByValue: true,
      awaitPromise: true,
    });
    return callSchema.parse(response).result.value;
  }

  /** The centre of the element's first box in the viewport, or null when it has none (display: none, zero size). */
  async function centre(tab: Tab, node: number): Promise<Point | null> {
    try {
      const { quads } = quadsSchema.parse(await tab.cdp('DOM.getContentQuads', { backendNodeId: node }));
      const q = quads[0];
      if (q === undefined || q.length < 8) return null;
      const xs = [q[0], q[2], q[4], q[6]].map(Number);
      const ys = [q[1], q[3], q[5], q[7]].map(Number);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      if (width < 1 || height < 1) return null;
      return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    } catch {
      // "Could not compute content quads": the element is not rendered.
      return null;
    }
  }

  /** How the element covering a point describes itself: `div.modal-backdrop`. */
  async function describeAt(tab: Tab, point: Point): Promise<{ objectId: string; label: string } | null> {
    const hit = hitSchema.safeParse(
      await tab.cdp('DOM.getNodeForLocation', { x: Math.round(point.x), y: Math.round(point.y) }),
    );
    if (!hit.success) return null;
    const { object } = objectSchema.parse(await tab.cdp('DOM.resolveNode', { backendNodeId: hit.data.backendNodeId }));
    const label = await call(
      tab,
      object.objectId,
      `function () {
        const el = this.nodeType === 1 ? this : this.parentElement;
        if (el === null) return '#text';
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
      }`,
    );
    return { objectId: object.objectId, label: String(label) };
  }

  const frame = (tab: Tab) => tab.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');

  /**
   * A point where a click reaches the element (29 §5.5): scrolled into view, at rest for two frames, and the element
   * (or something inside it) is what is hit there. Retried until BROWSER_ACTION_TIMEOUT_MS, then the reason.
   */
  async function hittable(tab: Tab, ref: string, node: number, objectId: string): Promise<Point> {
    const state = z.object({ connected: z.boolean(), disabled: z.boolean() }).parse(
      await call(
        tab,
        objectId,
        `function () {
            return { connected: this.isConnected,
              disabled: this.disabled === true || this.getAttribute?.('aria-disabled') === 'true' };
          }`,
      ),
    );
    if (!state.connected) throw failed(BrowserActionFailure.Detached, ref);
    if (state.disabled) throw failed(BrowserActionFailure.Disabled, ref);
    const deadline = clock.now() + BROWSER_ACTION_TIMEOUT_MS;
    let reason: BrowserActionFailure = BrowserActionFailure.NotVisible;
    let coveredBy: string | null = null;
    for (;;) {
      await tab.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId: node }).catch(() => undefined);
      const before = await centre(tab, node);
      await frame(tab);
      const after = await centre(tab, node);
      if (before !== null && after !== null && before.x === after.x && before.y === after.y) {
        const hit = await describeAt(tab, after);
        const reaches =
          hit !== null &&
          (await call(tab, objectId, 'function (hit) { return this === hit || this.contains(hit); }', [
            { objectId: hit.objectId },
          ])) === true;
        if (reaches) return after;
        reason = BrowserActionFailure.Covered;
        coveredBy = hit?.label ?? null;
      } else if (after !== null) {
        reason = BrowserActionFailure.Covered;
      }
      if (clock.now() >= deadline) {
        throw failed(reason, ref, reason === BrowserActionFailure.Covered ? { coveredBy } : {});
      }
      await frame(tab);
    }
  }

  async function clickAt(tab: Tab, point: Point): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await tab.cdp('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
  }

  async function press(tab: Tab, key: BrowserKey): Promise<void> {
    const { key: name, code, keyCode, text } = KEYS[key];
    const base = { key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await tab.cdp('Input.dispatchKeyEvent', { ...base, type: text === undefined ? 'rawKeyDown' : 'keyDown', text });
    await tab.cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  return {
    async click(tab: Tab, ref: string): Promise<void> {
      const { node, objectId } = await resolve(tab, ref);
      await clickAt(tab, await hittable(tab, ref, node, objectId));
    },

    /** Focuses the field by clicking it, so `Input.insertText` reaches it and not the previous field (29 §5.5). */
    async type(tab: Tab, ref: string, input: { text: string; clear: boolean; submit: boolean }): Promise<void> {
      const { node, objectId } = await resolve(tab, ref);
      await clickAt(tab, await hittable(tab, ref, node, objectId));
      const focused = await call(
        tab,
        objectId,
        'function () { const a = document.activeElement; return a !== null && (this === a || this.contains(a)); }',
      );
      if (focused !== true) throw failed(BrowserActionFailure.NotFocusable, ref);
      if (input.clear) {
        await call(
          tab,
          objectId,
          `function () {
            if (typeof this.select === 'function') this.select();
            else document.execCommand('selectAll');
          }`,
        );
        if (input.text === '') await press(tab, 'Backspace');
      }
      if (input.text !== '') await tab.cdp('Input.insertText', { text: input.text });
      if (input.submit) await press(tab, 'Enter');
    },

    async select(tab: Tab, ref: string, values: readonly string[]): Promise<void> {
      const { objectId } = await resolve(tab, ref);
      const missing = z
        .array(z.string())
        .nullable()
        .parse(
          await call(
            tab,
            objectId,
            `function (values) {
            if (this.tagName !== 'SELECT') return null;
            const options = [...this.options];
            const missing = values.filter((v) => !options.some((o) => o.label === v || o.value === v));
            if (missing.length > 0) return missing;
            for (const o of options) o.selected = values.includes(o.label) || values.includes(o.value);
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
            return [];
          }`,
            [values],
          ),
        );
      if (missing === null) throw new AppError(ErrorCode.ValidationFailed, `${ref} is not a dropdown`, { ref });
      if (missing.length > 0) {
        throw new AppError(ErrorCode.ValidationFailed, `No such options in ${ref}`, { ref, missing });
      }
    },

    press,

    /** Where the element is, whether it is covered, a few computed styles and its text (29 §6). */
    async inspect(tab: Tab, ref: string) {
      const { node, objectId } = await resolve(tab, ref);
      const point = await centre(tab, node);
      const hit = point === null ? null : await describeAt(tab, point);
      const reaches =
        hit !== null &&
        (await call(tab, objectId, 'function (hit) { return this === hit || this.contains(hit); }', [
          { objectId: hit.objectId },
        ])) === true;
      const facts = z
        .object({
          text: z.string(),
          box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
          inViewport: z.boolean(),
          styles: z.record(z.string(), z.string()),
        })
        .parse(
          await call(
            tab,
            objectId,
            `function () {
              const r = this.getBoundingClientRect();
              const s = getComputedStyle(this);
              const box = r.width === 0 && r.height === 0 ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
              return {
                text: (this.innerText ?? this.textContent ?? '').trim().slice(0, 2000),
                box,
                inViewport: box !== null && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
                styles: { display: s.display, color: s.color, 'background-color': s.backgroundColor,
                  'font-size': s.fontSize, overflow: s.overflow },
              };
            }`,
          ),
        );
      return { ...facts, coveredBy: reaches || hit === null ? null : hit.label };
    },

    /** Waits until `text` appears in (or `gone` leaves) the page, watching DOM changes; false after `timeoutMs`. */
    async waitFor(tab: Tab, input: { text: string; gone: boolean; timeoutMs: number }): Promise<boolean> {
      const met = await tab.evaluate(`new Promise((resolve) => {
        const want = ${JSON.stringify(input.text)};
        const gone = ${input.gone};
        const ok = () => document.body !== null && document.body.innerText.includes(want) !== gone;
        if (ok()) return resolve(true);
        const observer = new MutationObserver(() => { if (ok()) { observer.disconnect(); clearTimeout(limit); resolve(true); } });
        const limit = setTimeout(() => { observer.disconnect(); resolve(false); }, ${input.timeoutMs});
        observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      })`);
      return met === true;
    },
  };
}

export type BrowserActions = ReturnType<typeof createActions>;
