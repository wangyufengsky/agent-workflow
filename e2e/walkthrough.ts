import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Where the walkthrough screenshots go (not committed); `AW_WALKTHROUGH_DIR` overrides it. */
export const WALKTHROUGH_DIR = process.env.AW_WALKTHROUGH_DIR ?? 'screenshots/walkthrough';

export type PageReport = {
  /** Problems: text below WCAG AA contrast and horizontal overflow. */
  contrast: string[];
  overflow: string[];
  /** Text elements axe checked, and those it could not decide (background image, overlap) left for the reviewer. */
  contrastChecked: number;
  contrastUndecided: string[];
};

/**
 * Text below WCAG AA contrast (axe `color-contrast`: 4.5:1, large text 3:1; disabled controls are exempt) and
 * horizontal overflow at the current width (01 §5 item 8).
 */
export async function inspectPage(page: Page): Promise<PageReport> {
  // axe cannot decide text over a background image, and the shell lays a faint decorative gradient over its solid
  // colours (14 §4), so nearly every text would be undecided. Drop the images while axe runs; the theme contrast unit
  // test checks text where those gradients are strongest. Colours still easing in after the theme was applied would
  // be measured mid-way, so transitions end at once.
  // Messages fade in (the assistant panel, D84): axe waits for one-shot animations; looping indicators keep running.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY),
  );
  const noImages = await page.addStyleTag({
    content: '*, *::before, *::after { background-image: none !important; transition: none !important; }',
  });
  const axe = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  await noImages.evaluate((el) => el.remove());
  const describe = (results: typeof axe.violations) =>
    results.flatMap((r) => r.nodes.map((n) => `${n.target.join(' ')} — ${n.any[0]?.message ?? r.help}`));
  return {
    contrast: describe(axe.violations),
    overflow: await page.evaluate(findOverflow),
    contrastChecked: axe.passes.reduce((sum, r) => sum + r.nodes.length, 0),
    contrastUndecided: describe(axe.incomplete),
  };
}

/** Grows the viewport to the tallest scrolling area so a screenshot shows the whole page, not just the first screen. */
export async function fullHeight(page: Page, width: number, height: number): Promise<void> {
  const tallest = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll('*')].map((el) =>
        getComputedStyle(el).overflowY === 'auto' || getComputedStyle(el).overflowY === 'scroll'
          ? el.scrollHeight - el.clientHeight
          : 0,
      ),
    ),
  );
  if (tallest > 0) await page.setViewportSize({ width, height: Math.min(height + tallest, 6000) });
}

/**
 * Runs in the page. Two kinds of overflow: an element reaching past the viewport outside any container that clips or
 * scrolls it, and a container that scrolls sideways. Code, diffs, terminal-like output and the canvas scroll on
 * purpose and are left out.
 */
function findOverflow(): string[] {
  const width = document.documentElement.clientWidth;
  const describe = (el: Element) => {
    const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.id;
    const text = (el.textContent ?? '').trim().slice(0, 40);
    return `<${el.tagName.toLowerCase()}${id ? ` ${id}` : ''}> ${text}`;
  };
  const scrollsOnPurpose = (el: Element) =>
    el.closest('pre, code, textarea, .react-flow, [data-testid="diff-view"], [data-testid="transcript"]') !== null;
  const found: string[] = [];
  if (document.documentElement.scrollWidth > width + 1)
    found.push(`document scrolls sideways (${document.documentElement.scrollWidth}px)`);
  for (const el of document.body.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || scrollsOnPurpose(el)) continue;
    const style = getComputedStyle(el);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      found.push(`scrolls sideways: ${describe(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    if (rect.right <= width + 1 && rect.left >= -1) continue;
    let clipped = false;
    for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') {
        clipped = true;
        break;
      }
    }
    if (!clipped) found.push(`past the viewport: ${describe(el)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
  }
  return found;
}
