import { SLIDE_FIT_MIN_SCALE, type SlideContent, type ThemeId } from '@aw/shared';
import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import { THEMES } from '../../../theme/registry.ts';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './geometry.ts';
import styles from './slide.module.css';
import { SlideBody } from './slide-body.tsx';

const FIT_STEP = 0.05;

/** The PPT's theme as variables on the page itself, not `:root`: a PPT keeps its theme in any app theme (23 §5.2). */
function paletteStyle(theme: ThemeId): CSSProperties {
  const p = THEMES[theme].slides;
  return {
    '--slide-bg': p.bg,
    '--slide-surface': p.surface,
    '--slide-ink': p.ink,
    '--slide-sub': p.sub,
    '--slide-accent': p.accent,
    '--slide-fill': p.fill,
    '--slide-on-fill': p.onFill,
    '--slide-line': p.line,
    '--slide-code-bg': p.codeBg,
    '--slide-code-ink': p.codeInk,
  } as CSSProperties;
}

const overflows = (el: Element) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;

/**
 * Shrinks the page's text regions together until they fit, down to `SLIDE_FIT_MIN_SCALE`; whether text still does not
 * fit is reported (23 §5.4). Measured on the unscaled layout, so it does not depend on the shown size.
 */
function fitText(canvas: HTMLElement): boolean {
  const regions = [...canvas.querySelectorAll('[data-fit]')];
  for (let scale = 1; scale >= SLIDE_FIT_MIN_SCALE - 1e-9; scale -= FIT_STEP) {
    canvas.style.setProperty('--fit', String(scale));
    if (!regions.some(overflows)) return false;
  }
  return true;
}

/**
 * One page at `width` CSS pixels (23 §5.3): the 1280×720 canvas scaled down. Pages not made yet show their outline
 * title as a placeholder.
 */
export function SlideView({
  content,
  placeholder,
  theme,
  width,
  onOverflow,
}: {
  content: SlideContent | null;
  placeholder?: string;
  theme: ThemeId;
  width: number;
  onOverflow?(overflow: boolean): void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (canvas.current === null || content === null) return;
    const overflow = fitText(canvas.current);
    onOverflow?.(overflow);
  }, [content, onOverflow]);
  const scale = width / SLIDE_WIDTH;
  return (
    <div className={styles.frameBox} style={{ width, height: SLIDE_HEIGHT * scale }}>
      <div
        ref={canvas}
        className={styles.canvas}
        style={{ ...paletteStyle(theme), transform: `scale(${scale})` }}
        data-testid="slide-canvas"
      >
        {content === null ? <div className={styles.placeholder}>{placeholder}</div> : <SlideBody content={content} />}
      </div>
    </div>
  );
}
