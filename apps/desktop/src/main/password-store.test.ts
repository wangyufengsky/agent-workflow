import { describe, expect, it } from 'vitest';
import { passwordStoreSwitch } from './password-store.ts';

describe('Linux 的 --password-store（D167）', () => {
  it('Chromium 不认识的桌面环境也走 Secret Service，而不是写死的密钥', () => {
    expect(passwordStoreSwitch('linux', {}, false)).toBe('gnome-libsecret');
    expect(passwordStoreSwitch('linux', { XDG_CURRENT_DESKTOP: 'MATE' }, false)).toBe('gnome-libsecret');
    expect(passwordStoreSwitch('linux', { XDG_CURRENT_DESKTOP: 'UKUI' }, false)).toBe('gnome-libsecret');
  });

  it('KDE 会话保留 Chromium 自己选的 KWallet，已存的密文仍能解开', () => {
    expect(passwordStoreSwitch('linux', { XDG_CURRENT_DESKTOP: 'KDE' }, false)).toBeUndefined();
    expect(passwordStoreSwitch('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:KDE' }, false)).toBeUndefined();
    expect(passwordStoreSwitch('linux', { DESKTOP_SESSION: 'kde-plasma' }, false)).toBeUndefined();
    expect(passwordStoreSwitch('linux', { KDE_FULL_SESSION: 'true' }, false)).toBeUndefined();
  });

  it('用户自己传了 --password-store 时不覆盖；macOS 与 Windows 不需要', () => {
    expect(passwordStoreSwitch('linux', {}, true)).toBeUndefined();
    expect(passwordStoreSwitch('darwin', {}, false)).toBeUndefined();
    expect(passwordStoreSwitch('win32', {}, false)).toBeUndefined();
  });
});
