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
const SURFACES: ThemeTokenName[] = ['bg', 'panel', 'sidebar'];
/** Tints laid over a surface under text: hover and pressed rows, selected cards and chips. */
const TINTS: ThemeTokenName[] = ['fill-1', 'fill-2', 'fill-3', 'accent-fill'];
const MIN = 4.5;

describe.each(THEME_IDS)('主题 %s 对比度', (id) => {
  const tokens = THEMES[id].tokens;
  const color = (name: ThemeTokenName) => parseColor(tokens[name]);

  it('正文与次要文字在 bg / panel / sidebar 及其上的悬停、选中底色上 ≥ 4.5:1', () => {
    for (const surface of SURFACES) {
      const backgrounds = [
        [surface, color(surface)] as const,
        ...TINTS.map((tint) => [`${tint} over ${surface}`, over(color(tint), color(surface))] as const),
      ];
      for (const [name, background] of backgrounds) {
        for (const text of TEXT) {
          expect(contrast(color(text), background), `${text} on ${name}`).toBeGreaterThanOrEqual(MIN);
        }
      }
    }
  });

  // The shell layers a decorative gradient over its solid colour (base.css: main = glow over bg, sidebar = glass over
  // sidebar); text has to stay readable where the gradient is strongest. The E2E walkthrough leaves them to this test.
  it('正文与次要文字在外框渐变最浓处 ≥ 4.5:1', () => {
    for (const [gradient, base] of [
      ['glow', 'bg'],
      ['glass', 'sidebar'],
    ] as const) {
      const stops = (tokens[gradient].match(/rgba\([^)]+\)/g) ?? []).map(parseColor);
      const strongest = stops.reduce((a, b) => (b[3] > a[3] ? b : a));
      const surface = over(strongest, color(base));
      for (const text of TEXT) {
        expect(contrast(color(text), surface), `${text} on ${gradient} over ${base}`).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  it('状态文字在自身填充色上 ≥ 4.5:1（填充色叠在 bg / panel 上）', () => {
    for (const tone of [...STATUS_TONES, 'stall'] as const) {
      for (const surface of SURFACES.filter((s) => s !== 'sidebar')) {
        const fill = over(color(`${tone}-fill`), color(surface));
        expect(contrast(color(tone), fill), `${tone} on ${tone}-fill over ${surface}`).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  // Canvas nodes are opaque cards: the E2E walkthrough usually cannot decide their text (overlapped by the canvas
  // layers), so the tokens are checked here.
  it('画布节点上的文字与状态标签 ≥ 4.5:1（node-bg）', () => {
    const node = color('node-bg');
    for (const text of TEXT) {
      expect(contrast(color(text), node), `${text} on node-bg`).toBeGreaterThanOrEqual(MIN);
    }
    for (const tone of STATUS_TONES) {
      const fill = over(color(`${tone}-fill`), node);
      expect(contrast(color(tone), fill), `${tone} on ${tone}-fill over node-bg`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('侧栏「任务」旁的数量徽标（stall）在侧栏、悬停与选中项上 ≥ 4.5:1', () => {
    for (const tint of [undefined, 'fill-3', 'fill-4'] as const) {
      const item = tint === undefined ? color('sidebar') : over(color(tint), color('sidebar'));
      const badge = over(color('stall-fill'), item);
      expect(contrast(color('stall'), badge), `stall on ${tint ?? 'sidebar'}`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('主按钮与品牌按钮文字（含悬停）≥ 4.5:1', () => {
    expect(contrast(color('primary-ink'), color('primary-bg'))).toBeGreaterThanOrEqual(MIN);
    for (const fill of ['brand', 'brand-hover'] as const) {
      expect(contrast(color('on-brand'), color(fill)), `on-brand on ${fill}`).toBeGreaterThanOrEqual(MIN);
    }
  });
});
