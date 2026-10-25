import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Platform } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { withLoginShellEnv } from './shell-path.ts';

/** What a GUI app gets from launchd on macOS (Finder, Dock). */
const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * A stand-in login shell: its startup files print to stdout (as `.zshrc` banners do), add Homebrew's directory and
 * export the variables an intranet model provider reads, then it runs the command it is given with `-ilc`.
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
      'LLM_API_KEY=from-zshrc; HOME=/Users/zshrc; export LLM_API_KEY HOME',
      'eval "$2"',
      'echo "bye from .zlogout"',
    ].join('\n'),
  );

// Windows has no login shell to ask; that case is the last test and runs everywhere.
describe.skipIf(process.platform === Platform.Win32)('后端的环境变量取自登录 shell（D117、D161）', () => {
  it('从 Finder 启动时带上登录 shell 的变量与目录，当前已有的变量不被覆盖，shell 自身的变量不带', async () => {
    const env = await withLoginShellEnv(Platform.Darwin, { PATH: GUI_PATH, HOME: '/Users/me' }, loginShell());
    expect(env).toEqual({ PATH: `/opt/fake-brew/bin:${GUI_PATH}`, HOME: '/Users/me', LLM_API_KEY: 'from-zshrc' });
  });

  it('从终端启动、PATH 已包含登录 shell 的目录时 PATH 原样不变，变量以当前的为准', async () => {
    const terminal = `/Users/me/.venv/bin:/opt/fake-brew/bin:${GUI_PATH}`;
    const env = await withLoginShellEnv(Platform.Linux, { PATH: terminal, LLM_API_KEY: 'exported' }, loginShell());
    expect(env).toMatchObject({ PATH: terminal, LLM_API_KEY: 'exported' });
  });

  it('变量的值含换行与等号时原样带上', async () => {
    const shell = fakeShell(['CA_BUNDLE="line1', 'line2=x"; export CA_BUNDLE', 'eval "$2"'].join('\n'));
    expect((await withLoginShellEnv(Platform.Darwin, { PATH: GUI_PATH }, shell)).CA_BUNDLE).toBe('line1\nline2=x');
  });

  it('登录 shell 失败或不结束时沿用原环境', async () => {
    const failing = fakeShell('echo "zshrc: syntax error" >&2; exit 1');
    expect(await withLoginShellEnv(Platform.Darwin, { PATH: GUI_PATH }, failing)).toEqual({ PATH: GUI_PATH });
    const hanging = fakeShell('exec tail -f /dev/null');
    expect(await withLoginShellEnv(Platform.Darwin, { PATH: GUI_PATH }, hanging, 200)).toEqual({ PATH: GUI_PATH });
  });
});

it('Windows 不问登录 shell', async () => {
  const env = { Path: 'C:\\Windows' };
  expect(await withLoginShellEnv(Platform.Win32, env, 'C:\\no\\such\\shell.exe')).toBe(env);
});
