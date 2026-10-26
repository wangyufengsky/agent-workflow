import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The shortcut's file name on the desktop, the same as the deb's menu entry (`linux.executableName`). */
export const SHORTCUT_FILE = 'agent-workflow.desktop';
/** Where the deb installs its menu entry (electron-builder: `/usr/share/applications/<executableName>.desktop`). */
export const DEB_MENU_ENTRY = `/usr/share/applications/${SHORTCUT_FILE}`;
/** In the user data directory: the shortcut was made once, so one the user deleted stays deleted. */
const MARKER = 'desktop-shortcut';

/** A path as one argument of a desktop entry's `Exec` (freedesktop: quoted, then string-escaped). */
function execArg(path: string): string {
  return `"${path.replace(/["`$\\]/g, '\\$&')}"`.replace(/\\/g, '\\\\');
}

/**
 * The AppImage has no menu entry of its own: the shortcut starts the file where it is now and shows the icon copied
 * next to the user data. `StartupWMClass` is the product name, as in the deb's entry, so the window joins it.
 */
export function appImageEntry(appImage: string, icon: string): string {
  return [
    '[Desktop Entry]',
    'Name=Agent Workflow',
    `Exec=${execArg(appImage)} %U`,
    'Terminal=false',
    'Type=Application',
    `Icon=${icon}`,
    'StartupWMClass=Agent Workflow',
    'Categories=Development;',
    '',
  ].join('\n');
}

export type ShortcutPlace = {
  userData: string;
  /** The user's desktop folder (`app.getPath('desktop')`, localised such as `~/桌面`). */
  desktop: string;
  /** `$APPIMAGE` when running from an AppImage. */
  appImage: string | undefined;
  /** The packaged icon, copied for an AppImage's shortcut. */
  appIcon: string;
  menuEntry: string;
};

/**
 * Puts the app on the Linux desktop on its first start (17 §3.8, D191): the deb's menu entry as it is, or for an
 * AppImage an entry for the file. Made once; nothing when there is no desktop folder or no entry to copy (another
 * way of installing). Returns the shortcut it wrote.
 */
export function createDesktopShortcut(place: ShortcutPlace): string | undefined {
  const marker = join(place.userData, MARKER);
  if (existsSync(marker) || !existsSync(place.desktop)) return undefined;
  let entry: string;
  if (place.appImage !== undefined) {
    const icon = join(place.userData, 'icon.png');
    copyFileSync(place.appIcon, icon);
    entry = appImageEntry(place.appImage, icon);
  } else if (existsSync(place.menuEntry)) {
    entry = readFileSync(place.menuEntry, 'utf8');
  } else {
    return undefined;
  }
  const shortcut = join(place.desktop, SHORTCUT_FILE);
  // Desktops only launch an entry that is executable.
  writeFileSync(shortcut, entry, { mode: 0o755 });
  writeFileSync(marker, '');
  return shortcut;
}
