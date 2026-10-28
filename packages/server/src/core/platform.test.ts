import { Platform } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { platformRules } from './platform.ts';

const windows = platformRules(Platform.Win32);
const linux = platformRules(Platform.Linux);

describe('平台规则', () => {
  it('Windows 上按不区分大小写读取环境变量，POSIX 上区分', () => {
    const env = { Path: 'C:\\Git\\cmd;C:\\npm', USERPROFILE: 'C:\\Users\\me', HOME: '/home/me' };
    expect(windows.pathDirs(env)).toEqual(['C:\\Git\\cmd', 'C:\\npm']);
    expect(windows.homeDir(env)).toBe('C:\\Users\\me');
    expect(linux.pathDirs(env)).toEqual([]);
    expect(linux.homeDir(env)).toBe('/home/me');
  });

  it('应用自带的程序目录排在用户 PATH 之后，Windows 上沿用原有的变量名（D213）', () => {
    expect(linux.pathAppending({ PATH: '/usr/bin:/bin' }, '/opt/aw/ripgrep')).toEqual({
      PATH: '/usr/bin:/bin:/opt/aw/ripgrep',
    });
    expect(linux.pathAppending({}, '/opt/aw/ripgrep')).toEqual({ PATH: '/opt/aw/ripgrep' });
    expect(windows.pathAppending({ Path: 'C:\\Git\\cmd' }, 'C:\\aw\\ripgrep')).toEqual({
      Path: 'C:\\Git\\cmd;C:\\aw\\ripgrep',
    });
  });

  it('git 输出的正斜杠路径在 Windows 上转为本机形式', () => {
    expect(windows.fromGitPath('C:/Users/me/repo')).toBe('C:\\Users\\me\\repo');
    expect(linux.fromGitPath('/home/me/repo')).toBe('/home/me/repo');
  });

  it('由 git --exec-path 找到 Git for Windows 自带的 bash', () => {
    expect(windows.gitBashOf('C:/Program Files/Git/mingw64/libexec/git-core')).toBe(
      'C:\\Program Files\\Git\\bin\\bash.exe',
    );
  });
});
