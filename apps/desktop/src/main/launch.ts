import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type LaunchPreferences, launchPreferencesSchema, SYSTEM_THEME_MAP } from '@aw/shared';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * How this start looks before the backend is up (28 §5.3): what the renderer left in `launch.json` last time. A
 * first start has no file; a file that does not parse is treated the same, since it only decides a frame's colours:
 * the system's light or dark theme, with the animation.
 */
export function readLaunchPreferences(file: string, prefersDark: boolean): LaunchPreferences {
  const firstStart: LaunchPreferences = {
    theme: prefersDark ? SYSTEM_THEME_MAP.dark : SYSTEM_THEME_MAP.light,
    intro: true,
  };
  if (!existsSync(file)) return firstStart;
  const parsed = launchPreferencesSchema.safeParse(parseJson(readFileSync(file, 'utf8')));
  return parsed.success ? parsed.data : firstStart;
}

/** Keeps what the renderer applied for the next start; it comes over IPC, so it is checked here. */
export function writeLaunchPreferences(file: string, preferences: unknown): void {
  writeFileSync(file, JSON.stringify(launchPreferencesSchema.parse(preferences)));
}
