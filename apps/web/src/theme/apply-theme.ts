import { SYSTEM_THEME_MAP, type ThemeId, ThemePreference } from '@aw/shared';
import { THEMES } from './registry.ts';
import { THEME_TOKEN_NAMES } from './tokens.ts';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The concrete theme for a preference; `system` follows the OS colour scheme (08 §2.1). */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ThemeId {
  if (preference !== ThemePreference.System) return preference;
  return prefersDark ? SYSTEM_THEME_MAP.dark : SYSTEM_THEME_MAP.light;
}

/** Writes the theme's tokens as `:root` custom properties; takes effect immediately, no reload. */
export function applyTheme(id: ThemeId, root: HTMLElement = document.documentElement): void {
  const theme = THEMES[id];
  for (const name of THEME_TOKEN_NAMES) root.style.setProperty(`--${name}`, theme.tokens[name]);
  root.style.colorScheme = theme.colorScheme;
  root.dataset.theme = id;
}
