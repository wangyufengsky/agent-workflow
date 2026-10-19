import { STATUS_TONES, THEME_IDS } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { THEMES } from './registry.ts';
import type { ThemeTokenName } from './tokens.ts';

type Rgba = [r: number, g: number, b: number, a: number];

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba?.[1] !== undefined) {
    const [r = 0, g = 0, b = 0, a = 1] = rgba[1].split(',').map((p) => Number(p.trim()));
    return [r, g, b, a];
  }
  throw new Error(`Unsupported colour ${value}`);
}

/** Alpha-composites `top` over an opaque `base`. */
function over(top: Rgba, base: Rgba): Rgba {
  const [r, g, b, a] = top;
  return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: ThemeTokenName[] = ['ink', 'ink-2', 'sub', 'muted'];
const SURFACES: ThemeTokenName[] = ['bg', 'panel'];
const MIN = 4.5;

describe.each(THEME_IDS)('主题 %s 对比度', (id) => {
  const tokens = THEMES[id].tokens;
  const color = (name: ThemeTokenName) => parseColor(tokens[name]);

  it('正文与次要文字在 bg / panel 上 ≥ 4.5:1', () => {
    for (const surface of SURFACES) {
      for (const text of TEXT) {
        expect(contrast(color(text), color(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  it('状态文字在自身填充色上 ≥ 4.5:1', () => {
    for (const tone of [...STATUS_TONES, 'stall'] as const) {
      const fill = over(color(`${tone}-fill`), color('bg'));
      expect(contrast(color(tone), fill), `${tone} on ${tone}-fill`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('主按钮文字 ≥ 4.5:1', () => {
    expect(contrast(color('primary-ink'), color('primary-bg'))).toBeGreaterThanOrEqual(MIN);
  });
});
