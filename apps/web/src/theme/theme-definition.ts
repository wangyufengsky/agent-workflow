import type { ThemeId } from '@aw/shared';
import type { ThemeTokens } from './tokens.ts';

/** A theme is data: adding one = a new themes/*.ts + its ThemeId + a registry entry (14 §4). */
export type ThemeDefinition = {
  id: ThemeId;
  colorScheme: 'light' | 'dark';
  tokens: ThemeTokens;
  /** shiki theme for code highlighting (M4-07). */
  codeTheme: string;
};
