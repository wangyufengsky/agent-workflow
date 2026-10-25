/**
 * The `--password-store` main sets on Linux before `ready` (D167), when the user gave none. Chromium chooses the key
 * store from the desktop environment and, on one it does not know (MATE, LXQt, tiling window managers, xrdp / VNC
 * sessions without `XDG_CURRENT_DESKTOP`), falls back to `basic_text`, a key written in its source, even while a
 * Secret Service (gnome-keyring, KeePassXC) is running. Asking for libsecret there uses that service, and is the
 * same choice Chromium already makes on GNOME, Deepin, UKUI, XFCE and the rest. KDE keeps its KWallet: what was
 * sealed there would not open from another store.
 */
export function passwordStoreSwitch(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  userChose: boolean,
): 'gnome-libsecret' | undefined {
  if (platform !== 'linux' || userChose) return undefined;
  const kde =
    (env.XDG_CURRENT_DESKTOP ?? '').split(':').includes('KDE') ||
    env.KDE_FULL_SESSION !== undefined ||
    (env.DESKTOP_SESSION ?? '').startsWith('kde');
  return kde ? undefined : 'gnome-libsecret';
}
