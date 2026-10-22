import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Platform } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { withLoginShellPath } from './shell-path.ts';

/** What a GUI app gets from launchd on macOS (Finder, Dock). */
const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * A stand-in login shell: its startup files print to stdout (as `.zshrc` banners do) and add Homebrew's directory,
 * then it runs the command it is given with `-ilc`.
 */
function fakeShell(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'aw-shell-')), 'zsh');
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const loginShell = () =>
  fakeShell(
    [
      '[ "$1" = -ilc ] || exit 64',
      'echo "Last login: Thu Oct 22 09:00:00 on ttys001"',
      'PATH=/opt/fake-brew/bin:$PATH; export PATH',
      'eval "$2"',
      'echo "bye from .zlogout"',
    ].join('\n'),
  );

// Windows has no login shell to ask; that case is the last test and runs everywhere.
describe.skipIf(process.platform === Platform.Win32)('后端的 PATH 取自登录 shell（D117）', () => {
  it('从 Finder 启动时带上登录 shell 加入的目录，顺序按登录 shell', async () => {
    const env = await withLoginShellPath(Platform.Darwin, { PATH: GUI_PATH, HOME: '/Users/me' }, loginShell());
    expect(env).toEqual({ PATH: `/opt/fake-brew/bin:${GUI_PATH}`, HOME: '/Users/me' });
  });

  it('从终端启动、PATH 已包含登录 shell 的目录时原样不变', async () => {
    const terminal = `/Users/me/.venv/bin:/opt/fake-brew/bin:${GUI_PATH}`;
    expect((await withLoginShellPath(Platform.Linux, { PATH: terminal }, loginShell())).PATH).toBe(terminal);
  });

  it('登录 shell 失败或不结束时沿用原 PATH', async () => {
    const failing = fakeShell('echo "zshrc: syntax error" >&2; exit 1');
    expect((await withLoginShellPath(Platform.Darwin, { PATH: GUI_PATH }, failing)).PATH).toBe(GUI_PATH);
    const hanging = fakeShell('exec tail -f /dev/null');
    expect((await withLoginShellPath(Platform.Darwin, { PATH: GUI_PATH }, hanging, 200)).PATH).toBe(GUI_PATH);
  });
});

it('Windows 不问登录 shell', async () => {
  const env = { Path: 'C:\\Windows' };
  expect(await withLoginShellPath(Platform.Win32, env, 'C:\\no\\such\\shell.exe')).toBe(env);
});
