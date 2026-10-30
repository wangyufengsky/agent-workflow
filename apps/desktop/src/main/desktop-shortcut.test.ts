import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appImageEntry, createDesktopShortcut, SHORTCUT_FILE, type ShortcutPlace } from './desktop-shortcut.ts';

function place(overrides: Partial<ShortcutPlace> = {}): ShortcutPlace {
  const root = mkdtempSync(join(tmpdir(), 'aw-shortcut-'));
  const dirs = { userData: join(root, 'config'), desktop: join(root, '桌面') };
  mkdirSync(dirs.userData);
  mkdirSync(dirs.desktop);
  const appIcon = join(root, 'icon.png');
  writeFileSync(appIcon, 'png');
  const menuEntry = join(root, SHORTCUT_FILE);
  writeFileSync(menuEntry, '[Desktop Entry]\nName=Agent Workflow\nExec="/opt/Agent Workflow/agent-workflow" %U\n');
  return { ...dirs, appImage: undefined, appIcon, menuEntry, ...overrides };
}

describe('Linux 桌面快捷方式（D191）', () => {
  it('deb：把菜单项原样放到桌面，可执行', () => {
    const p = place();
    const shortcut = createDesktopShortcut(p);
    expect(shortcut).toBe(join(p.desktop, SHORTCUT_FILE));
    expect(readFileSync(join(p.desktop, SHORTCUT_FILE), 'utf8')).toBe(readFileSync(p.menuEntry, 'utf8'));
    // Windows 不提供 POSIX 执行位；由文件系统检查可执行性，Linux 上仍会拒绝没有执行权限的文件。
    expect(() => accessSync(join(p.desktop, SHORTCUT_FILE), constants.X_OK)).not.toThrow();
  });

  it('AppImage：启动当前位置的文件，图标复制到用户数据目录', () => {
    const p = place({ appImage: '/home/张三/下载/agent-workflow-1.4.0-x86_64.AppImage' });
    createDesktopShortcut(p);
    const entry = readFileSync(join(p.desktop, SHORTCUT_FILE), 'utf8');
    expect(entry).toContain('Exec="/home/张三/下载/agent-workflow-1.4.0-x86_64.AppImage" %U');
    expect(entry).toContain(`Icon=${join(p.userData, 'icon.png')}`);
    expect(existsSync(join(p.userData, 'icon.png'))).toBe(true);
  });

  it('Exec 里的路径按规范转义引号、$ 与反斜杠', () => {
    expect(appImageEntry('/a b/"x"$y\\z', '/i.png')).toContain('Exec="/a b/\\\\"x\\\\"\\\\$y\\\\\\\\z" %U');
  });

  it('只放一次：用户删掉后不再出现', () => {
    const p = place();
    createDesktopShortcut(p);
    rmSync(join(p.desktop, SHORTCUT_FILE));
    expect(createDesktopShortcut(p)).toBeUndefined();
    expect(existsSync(join(p.desktop, SHORTCUT_FILE))).toBe(false);
  });

  it('没有桌面目录、或不是 deb 也不是 AppImage 时什么都不做，下次再试', () => {
    const noDesktop = place();
    rmSync(noDesktop.desktop, { recursive: true });
    expect(createDesktopShortcut(noDesktop)).toBeUndefined();
    const other = place();
    rmSync(other.menuEntry);
    expect(createDesktopShortcut(other)).toBeUndefined();
    writeFileSync(other.menuEntry, '[Desktop Entry]\n');
    expect(createDesktopShortcut(other)).toBe(join(other.desktop, SHORTCUT_FILE));
  });
});
