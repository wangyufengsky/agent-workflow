import type { ThemeId, ThemePreference } from '@aw/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { applyTheme, DARK_SCHEME_QUERY, resolveTheme } from './apply-theme.ts';

function subscribeColorScheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const prefersDark = () => window.matchMedia(DARK_SCHEME_QUERY).matches;

/** Applies the preferred theme to `:root` and keeps following the OS scheme while the preference is `system`. */
export function useAppliedTheme(preference: ThemePreference): ThemeId {
  const dark = useSyncExternalStore(subscribeColorScheme, prefersDark);
  const theme = resolveTheme(preference, dark);
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}
