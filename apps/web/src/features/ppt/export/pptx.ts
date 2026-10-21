import { type DeckDTO, type SlideContent, type SlideContentOf, SlideLayout } from '@aw/shared';
import type PptxGenJS from 'pptxgenjs';
import { THEMES } from '../../../theme/registry.ts';
import type { SlidePalette } from '../../../theme/theme-definition.ts';
import { emphasisRuns, SLIDE_PX_PER_INCH } from '../slide/geometry.ts';

/*
 * The PowerPoint export (23 §6.2, D94): each layout as native text boxes, shapes and tables at the canvas's own
 * geometry (pixels of slide.module.css converted to inches and points), so the file stays editable. Fonts are named,
 * not embedded: PowerPoint substitutes them where they are missing.
 */

/** Chinese UI fonts PowerPoint, Keynote and WPS commonly have. */
const FONT_FACE = 'Microsoft YaHei';
const MONO_FONT_FACE = 'Consolas';

type Pptx = InstanceType<typeof PptxGenJS>;
type Slide = ReturnType<Pptx['addSlide']>;
type Runs = PptxGenJS.TextProps[];

const inch = (px: number) => px / SLIDE_PX_PER_INCH;
/** CSS pixels to points (1 pt = 4/3 px). */
const pt = (px: number) => px * 0.75;
const hex = (color: string) => color.slice(1);

/** The canvas's content frame (`.frame` in slide.module.css). */
const FRAME = { x: 88, y: 64, w: 1280 - 2 * 88, titleH: 120, gap: 36, bottom: 56 };
const BODY_Y = FRAME.y + FRAME.titleH + FRAME.gap;
const BODY_H = 720 - BODY_Y - FRAME.bottom;

/** Text with its `**…**` runs bold in the accent colour; `paragraph` options start a new paragraph. */
function runs(text: string, p: SlidePalette, paragraph: PptxGenJS.TextPropsOptions = {}): Runs {
  const parts = emphasisRuns(text);
  return parts.map((run, i) => ({
    text: run.text,
    options: {
      ...(i === 0 ? paragraph : {}),
      ...(run.strong ? { bold: true, color: hex(p.accent) } : {}),
      ...(i === parts.length - 1 ? { breakLine: true } : {}),
    },
  }));
}

function bulletList(items: readonly string[], p: SlidePalette, sizePx: number, gapPx: number): Runs {
  return items.flatMap((item) =>
    runs(item, p, { bullet: { code: '25CF' }, paraSpaceAfter: pt(gapPx), fontSize: pt(sizePx) }),
  );
}

function text(
  slide: Slide,
  content: Runs | string,
  box: { x: number; y: number; w: number; h: number },
  options: PptxGenJS.TextPropsOptions,
) {
  slide.addText(content, {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    fontFace: FONT_FACE,
    valign: 'top',
    margin: 0,
    fit: 'shrink',
    ...options,
  });
}

function title(slide: Slide, value: string, p: SlidePalette): void {
  text(
    slide,
    runs(value, p),
    { x: FRAME.x, y: FRAME.y, w: FRAME.w, h: FRAME.titleH },
    {
      fontSize: pt(46),
      bold: true,
      color: hex(p.ink),
    },
  );
}

function box(slide: Slide, at: { x: number; y: number; w: number; h: number }, p: SlidePalette, fill = p.surface) {
  slide.addShape('roundRect', {
    x: inch(at.x),
    y: inch(at.y),
    w: inch(at.w),
    h: inch(at.h),
    rectRadius: inch(20),
    fill: { color: hex(fill) },
    line: { color: hex(p.line), width: 1.5 },
  });
}

/** `n` equal columns across the body with `gap` pixels between them. */
const columns = (n: number, gap: number) =>
  Array.from({ length: n }, (_, i) => {
    const w = (FRAME.w - gap * (n - 1)) / n;
    return { x: FRAME.x + i * (w + gap), w };
  });

function cover(slide: Slide, c: SlideContentOf<'cover'> | SlideContentOf<'section'>, p: SlidePalette): void {
  const section = c.layout === SlideLayout.Section;
  if (section) {
    slide.background = { color: hex(p.surface) };
    slide.addShape('rect', { x: 0, y: 0, w: inch(24), h: inch(720), fill: { color: hex(p.fill) } });
  } else {
    slide.addShape('roundRect', {
      x: inch(112),
      y: inch(236),
      w: inch(96),
      h: inch(10),
      rectRadius: inch(5),
      fill: { color: hex(p.fill) },
    });
  }
  text(
    slide,
    runs(c.title, p),
    { x: 112, y: 270, w: 1056, h: 220 },
    { fontSize: pt(68), bold: true, color: hex(p.ink) },
  );
  if (c.subtitle !== undefined) {
    text(slide, runs(c.subtitle, p), { x: 112, y: 500, w: 1056, h: 100 }, { fontSize: pt(30), color: hex(p.sub) });
  }
}

function body(slide: Slide, c: SlideContent, p: SlidePalette): void {
  switch (c.layout) {
    case SlideLayout.Cover:
    case SlideLayout.Section:
      cover(slide, c, p);
      return;
    case SlideLayout.Bullets:
      title(slide, c.title, p);
      text(
        slide,
        bulletList(c.bullets, p, 30, 22),
        { x: FRAME.x, y: BODY_Y, w: FRAME.w, h: BODY_H },
        {
          color: hex(p.ink),
        },
      );
      return;
    case SlideLayout.TwoColumn: {
      title(slide, c.title, p);
      const [left, right] = columns(2, 32);
      for (const [column, at] of [
        [c.left, left],
        [c.right, right],
      ] as const) {
        if (at === undefined) continue;
        box(slide, { x: at.x, y: BODY_Y, w: at.w, h: BODY_H }, p);
        const inner = { x: at.x + 36, w: at.w - 72 };
        text(
          slide,
          runs(column.heading, p),
          { ...inner, y: BODY_Y + 32, h: 48 },
          {
            fontSize: pt(30),
            bold: true,
            color: hex(p.accent),
          },
        );
        text(
          slide,
          bulletList(column.bullets, p, 26, 16),
          { ...inner, y: BODY_Y + 100, h: BODY_H - 132 },
          {
            color: hex(p.ink),
          },
        );
      }
      return;
    }
    case SlideLayout.Cards: {
      title(slide, c.title, p);
      columns(c.cards.length, 32).forEach((at, i) => {
        const card = c.cards[i];
        if (card === undefined) return;
        box(slide, { x: at.x, y: BODY_Y, w: at.w, h: BODY_H }, p);
        const inner = { x: at.x + 36, w: at.w - 72 };
        text(
          slide,
          runs(card.heading, p),
          { ...inner, y: BODY_Y + 32, h: 48 },
          {
            fontSize: pt(30),
            bold: true,
            color: hex(p.accent),
          },
        );
        text(
          slide,
          runs(card.body, p),
          { ...inner, y: BODY_Y + 100, h: BODY_H - 132 },
          {
            fontSize: pt(24),
            color: hex(p.sub),
          },
        );
      });
      return;
    }
    case SlideLayout.Steps: {
      title(slide, c.title, p);
      const top = BODY_Y + 60;
      columns(c.steps.length, 28).forEach((at, i, all) => {
        const step = c.steps[i];
        if (step === undefined) return;
        const next = all[i + 1];
        if (next !== undefined) {
          slide.addShape('rect', {
            x: inch(at.x + 84),
            y: inch(top + 34),
            w: inch(next.x - at.x - 104),
            h: inch(4),
            fill: { color: hex(p.line) },
          });
        }
        slide.addShape('ellipse', {
          x: inch(at.x),
          y: inch(top),
          w: inch(72),
          h: inch(72),
          fill: { color: hex(p.fill) },
        });
        text(
          slide,
          String(i + 1),
          { x: at.x, y: top, w: 72, h: 72 },
          {
            fontSize: pt(32),
            bold: true,
            color: hex(p.onFill),
            align: 'center',
            valign: 'middle',
          },
        );
        text(
          slide,
          runs(step.label, p),
          { x: at.x, y: top + 90, w: at.w, h: 80 },
          {
            fontSize: pt(28),
            bold: true,
            color: hex(p.ink),
          },
        );
        if (step.detail !== undefined) {
          text(
            slide,
            runs(step.detail, p),
            { x: at.x, y: top + 176, w: at.w, h: 140 },
            {
              fontSize: pt(22),
              color: hex(p.sub),
            },
          );
        }
      });
      return;
    }
    case SlideLayout.Stats: {
      title(slide, c.title, p);
      const top = BODY_Y + 80;
      columns(c.stats.length, 40).forEach((at, i) => {
        const stat = c.stats[i];
        if (stat === undefined) return;
        slide.addShape('rect', { x: inch(at.x), y: inch(top), w: inch(6), h: inch(170), fill: { color: hex(p.fill) } });
        text(
          slide,
          stat.value,
          { x: at.x + 34, y: top, w: at.w - 34, h: 96 },
          {
            fontSize: pt(76),
            bold: true,
            color: hex(p.accent),
          },
        );
        text(
          slide,
          runs(stat.label, p),
          { x: at.x + 34, y: top + 104, w: at.w - 34, h: 70 },
          {
            fontSize: pt(26),
            color: hex(p.sub),
          },
        );
      });
      return;
    }
    case SlideLayout.Table: {
      title(slide, c.title, p);
      const cell = (value: string, header: boolean): PptxGenJS.TableCell => ({
        text: runs(value, p),
        options: header
          ? { bold: true, color: hex(p.onFill), fill: { color: hex(p.fill) } }
          : { color: hex(p.ink), border: { type: 'solid', color: hex(p.line), pt: 1.5 } },
      });
      slide.addTable(
        [c.columns.map((column) => cell(column, true)), ...c.rows.map((row) => row.map((value) => cell(value, false)))],
        { x: inch(FRAME.x), y: inch(BODY_Y), w: inch(FRAME.w), fontFace: FONT_FACE, fontSize: pt(22), margin: pt(12) },
      );
      return;
    }
    case SlideLayout.Code: {
      title(slide, c.title, p);
      const h = c.caption === undefined ? BODY_H : BODY_H - 56;
      box(slide, { x: FRAME.x, y: BODY_Y, w: FRAME.w, h }, p, p.codeBg);
      text(
        slide,
        c.code,
        { x: FRAME.x + 32, y: BODY_Y + 28, w: FRAME.w - 64, h: h - 56 },
        {
          fontFace: MONO_FONT_FACE,
          fontSize: pt(22),
          color: hex(p.codeInk),
        },
      );
      text(
        slide,
        c.language,
        { x: FRAME.x + FRAME.w - 220, y: BODY_Y + 10, w: 200, h: 28 },
        {
          fontFace: MONO_FONT_FACE,
          fontSize: pt(18),
          color: hex(p.codeInk),
          align: 'right',
        },
      );
      if (c.caption !== undefined) {
        text(
          slide,
          runs(c.caption, p),
          { x: FRAME.x, y: BODY_Y + h + 20, w: FRAME.w, h: 36 },
          {
            fontSize: pt(22),
            color: hex(p.sub),
          },
        );
      }
      return;
    }
    case SlideLayout.Quote:
      text(slide, '“', { x: 136, y: 110, w: 200, h: 140 }, { fontSize: pt(160), bold: true, color: hex(p.accent) });
      text(
        slide,
        runs(c.quote, p),
        { x: 136, y: 250, w: 1008, h: 280 },
        {
          fontSize: pt(50),
          bold: true,
          color: hex(p.ink),
        },
      );
      if (c.attribution !== undefined) {
        text(
          slide,
          runs(c.attribution, p),
          { x: 136, y: 560, w: 1008, h: 50 },
          { fontSize: pt(26), color: hex(p.sub) },
        );
      }
      return;
  }
}

/** The PPT as .pptx bytes, in its own theme; pptxgenjs is loaded only now (not part of the first screen). */
export async function deckToPptx(deck: DeckDTO): Promise<Uint8Array> {
  const { default: PptxGenJSClass } = await import('pptxgenjs');
  const pptx = new PptxGenJSClass();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title;
  const palette = THEMES[deck.theme].slides;
  for (const page of deck.slides) {
    if (page.content === null) continue;
    const slide = pptx.addSlide();
    slide.background = { color: hex(palette.bg) };
    body(slide, page.content, palette);
    if (page.notes !== '') slide.addNotes(page.notes);
  }
  const bytes = await pptx.write({ outputType: 'uint8array' });
  if (!(bytes instanceof Uint8Array)) throw new Error('pptxgenjs did not return bytes');
  return bytes;
}
