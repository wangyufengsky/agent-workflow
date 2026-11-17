import { AppError, BROWSER_ACTION_TIMEOUT_MS, BrowserActionFailure, type BrowserKey, ErrorCode } from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { Tab } from './browser.tab.ts';

const objectSchema = z.object({ object: z.object({ objectId: z.string() }) });
const callSchema = z.object({ result: z.object({ value: z.unknown().optional() }) });
const quadsSchema = z.object({ quads: z.array(z.array(z.number())) });
const hitSchema = z.object({ backendNodeId: z.number() });
const layoutMetricsSchema = z.object({
  cssLayoutViewport: z.object({ pageX: z.number(), pageY: z.number() }),
  cssVisualViewport: z.object({
    offsetX: z.number(),
    offsetY: z.number(),
    clientWidth: z.number(),
    clientHeight: z.number(),
  }),
});

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

async function layoutMetrics(tab: Tab) {
  return layoutMetricsSchema.parse(await tab.cdp('Page.getLayoutMetrics'));
}

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

  /** The centre of the first content quad intersected with the visible viewport. */
  async function centre(tab: Tab, node: number): Promise<Point | null> {
    const raw = await tab.cdp('DOM.getContentQuads', { backendNodeId: node }).catch(() => null);
    if (raw === null) return null;
    const { quads } = quadsSchema.parse(raw);
    const q = quads[0];
    if (q === undefined || q.length < 8) return null;
    const xs = [q[0], q[2], q[4], q[6]].map(Number);
    const ys = [q[1], q[3], q[5], q[7]].map(Number);
    const { cssVisualViewport: v } = await layoutMetrics(tab);
    const left = Math.max(Math.min(...xs), v.offsetX);
    const right = Math.min(Math.max(...xs), v.offsetX + v.clientWidth);
    const top = Math.max(Math.min(...ys), v.offsetY);
    const bottom = Math.min(Math.max(...ys), v.offsetY + v.clientHeight);
    if (right - left < 1 || bottom - top < 1) return null;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  /** Hit testing takes document coordinates. The mouse event still takes viewport coordinates. */
  async function describeAt(tab: Tab, point: Point): Promise<{ objectId: string; label: string } | null> {
    const { cssLayoutViewport: v } = await layoutMetrics(tab);
    const result = await tab
      .cdp('DOM.getNodeForLocation', { x: Math.round(point.x + v.pageX), y: Math.round(point.y + v.pageY) })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.endsWith('No node found at given location')) return null;
        throw err;
      });
    const hit = hitSchema.safeParse(result);
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
        reason = hit === null ? BrowserActionFailure.NotVisible : BrowserActionFailure.Covered;
        coveredBy = hit?.label ?? null;
      } else if (after === null) {
        reason = BrowserActionFailure.NotVisible;
        coveredBy = null;
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
    async describeControl(tab: Tab, ref: string | null) {
      const describe = `function () {
        const el = this;
        const form = el.form ?? el.closest('form');
        const sensitive = (field) => field.matches(
          'input[type=password], input[type=file], [autocomplete*=password], [autocomplete=one-time-code], [autocomplete=webauthn]'
        );
        const fields = Array.from(form?.elements ?? []).filter((field) =>
          ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) && !field.disabled);
        const labelOf = (field) =>
          (field.getAttribute('aria-label') ?? field.labels?.[0]?.textContent ?? field.getAttribute('placeholder') ??
          field.getAttribute('name') ?? field.textContent?.trim() ?? '').trim().slice(0, 100) || field.tagName;
        return {
          label: labelOf(el),
          control: el.matches('button, input[type=button], input[type=submit], [role=button]'),
          disclosure: el.matches('details > summary, [role=tab]'),
          download: el.hasAttribute('download') || ['file', 'reset'].includes(el.type),
          signals: [el.id, el.name, el.getAttribute('title'), el.getAttribute('data-action'),
            el.getAttribute('aria-label'), el.textContent?.trim().slice(0, 120)].filter((item) => typeof item === 'string'),
          textField: el.isContentEditable || el.matches('textarea, input:is([type=text], [type=search], [type=email], [type=tel], [type=url], [type=number], [type=date], [type=time], :not([type]))'),
          link: el instanceof HTMLAnchorElement && !el.hasAttribute('download') ? el.href : null,
          formAction: el.hasAttribute('formaction') ? el.formAction : form?.action ?? null,
          formMethod: el.hasAttribute('formmethod') ? el.formMethod : form?.method ?? null,
          submit: form !== null && (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.type === 'submit',
          sensitive: !el.isConnected || sensitive(el) || fields.some(sensitive),
          state: JSON.stringify([el.tagName, el.id, el.name, el.type, el.value, el.checked,
            ...fields.map((field) => [field.name, field.value, field.checked])]),
          fields: fields.filter((field) =>
            !sensitive(field) && field.type !== 'hidden' &&
            (!['checkbox', 'radio'].includes(field.type) || field.checked)
          ).slice(0, 16).map((field) => labelOf(field) + ' · ' + String(field.value).slice(0, 200)),
        };
      }`;
      const data =
        ref === null
          ? await tab.evaluate(`(${describe}).call(document.activeElement ?? document.body)`)
          : await call(tab, (await resolve(tab, ref)).objectId, describe);
      return z
        .object({
          label: z.string(),
          control: z.boolean(),
          disclosure: z.boolean(),
          download: z.boolean(),
          signals: z.array(z.string()),
          textField: z.boolean(),
          link: z.string().nullable(),
          formAction: z.string().nullable(),
          formMethod: z.string().nullable(),
          submit: z.boolean(),
          sensitive: z.boolean(),
          state: z.string(),
          fields: z.array(z.string()),
        })
        .parse(data);
    },

    async click(tab: Tab, ref: string, beforeInput?: () => Promise<void>): Promise<void> {
      const { node, objectId } = await resolve(tab, ref);
      const point = await hittable(tab, ref, node, objectId);
      await beforeInput?.();
      await clickAt(tab, point);
    },

    /** Focuses the field by clicking it, so `Input.insertText` reaches it and not the previous field (29 §5.5). */
    async type(
      tab: Tab,
      ref: string,
      input: { text: string; clear: boolean; submit: boolean },
      beforeInput?: () => Promise<void>,
    ): Promise<void> {
      const { node, objectId } = await resolve(tab, ref);
      const point = await hittable(tab, ref, node, objectId);
      await beforeInput?.();
      await clickAt(tab, point);
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

    async select(tab: Tab, ref: string, values: readonly string[], beforeInput?: () => Promise<void>): Promise<void> {
      const { objectId } = await resolve(tab, ref);
      await beforeInput?.();
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

    /** Element clips are measured in document coordinates, even when the target is outside the viewport. */
    async screenshotClip(tab: Tab, ref: string): Promise<Box & { scale: number }> {
      const { node } = await resolve(tab, ref);
      const raw = await tab.cdp('DOM.getBoxModel', { backendNodeId: node }).catch(() => null);
      const result = z.object({ model: z.object({ border: z.array(z.number()).length(8) }) }).safeParse(raw);
      if (!result.success) throw failed(BrowserActionFailure.NotVisible, ref);
      const q = result.data.model.border;
      const xs = [q[0], q[2], q[4], q[6]].map(Number);
      const ys = [q[1], q[3], q[5], q[7]].map(Number);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - left;
      const height = Math.max(...ys) - top;
      if (width < 1 || height < 1) throw failed(BrowserActionFailure.NotVisible, ref);
      const { cssLayoutViewport: v } = await layoutMetrics(tab);
      return { x: left + v.pageX, y: top + v.pageY, width, height, scale: 1 };
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
