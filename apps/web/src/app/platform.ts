import { Platform } from '@aw/shared';

/**
 * The operating system the renderer runs on, for what the renderer itself shows: shortcut hints and the name of the
 * system file manager. Install commands follow `EnvironmentDTO.platform` (17 §3.7). Shortcuts accept both ⌘ and Ctrl.
 */
export const UI_PLATFORM: Platform = /Macintosh|Mac OS X/.test(navigator.userAgent)
  ? Platform.Darwin
  : /Windows/.test(navigator.userAgent)
    ? Platform.Win32
    : Platform.Linux;

/** Written before a shortcut's key: `⌘K` on macOS, `Ctrl+K` elsewhere. */
export const MOD_KEY = UI_PLATFORM === Platform.Darwin ? '⌘' : 'Ctrl+';
