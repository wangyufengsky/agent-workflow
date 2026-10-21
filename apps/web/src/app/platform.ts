/**
 * The renderer's one platform difference besides install commands (those follow `EnvironmentDTO.platform`, 17 §3.7):
 * how shortcut hints are written. Shortcuts themselves accept both ⌘ and Ctrl.
 */
export const MOD_KEY = /Macintosh|Mac OS X/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
