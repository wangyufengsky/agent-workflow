import type { ThemeId } from '@aw/shared';
import type { ThemeTokens } from './tokens.ts';

/**
 * The colours of a PPT shown in this theme (23 §5.2): opaque `#rrggbb` only, because the PowerPoint export takes them
 * as they are. `accent` is text on `bg` / `surface`; `fill` is a filled shape with `onFill` text on it.
 */
export type SlidePalette = {
  bg: string;
  surface: string;
  ink: string;
  sub: string;
  accent: string;
  fill: string;
  onFill: string;
  line: string;
  codeBg: string;
  codeInk: string;
};

/** A theme is data: adding one = a new themes/*.ts + its ThemeId + a registry entry (14 §4). */
export type ThemeDefinition = {
  id: ThemeId;
  colorScheme: 'light' | 'dark';
  tokens: ThemeTokens;
  /** shiki theme for code highlighting (M4-07). */
  codeTheme: string;
  slides: SlidePalette;
};
