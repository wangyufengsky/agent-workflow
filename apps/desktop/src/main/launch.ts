import { readFileSync, writeFileSync } from 'node:fs';
import { type LaunchPreferences, launchPreferencesSchema, SYSTEM_THEME_MAP } from '@aw/shared';

/** The file's JSON, or undefined when it is missing, unreadable or not JSON. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * How this start looks before the backend is up (28 §5.3): what the renderer left in `launch.json` last time. A
 * first start has no file; a file that cannot be read or does not parse is treated the same, since it only decides
 * a frame's colours and must not keep the window from showing: the system's light or dark theme, with the
 * animation.
 */
export function readLaunchPreferences(file: string, prefersDark: boolean): LaunchPreferences {
  const firstStart: LaunchPreferences = {
    theme: prefersDark ? SYSTEM_THEME_MAP.dark : SYSTEM_THEME_MAP.light,
    intro: true,
  };
  const parsed = launchPreferencesSchema.safeParse(readJson(file));
  return parsed.success ? parsed.data : firstStart;
}

/** Keeps what the renderer applied for the next start; it comes over IPC, so it is checked here. */
export function writeLaunchPreferences(file: string, preferences: unknown): LaunchPreferences {
  const parsed = launchPreferencesSchema.parse(preferences);
  writeFileSync(file, JSON.stringify(parsed));
  return parsed;
}
