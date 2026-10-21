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

  it('Windows 上可执行文件为 .exe 或 npm 的 .cmd 启动脚本', () => {
    expect(windows.executableNames('opencode')).toEqual(['opencode.exe', 'opencode.cmd']);
    expect(linux.executableNames('opencode')).toEqual(['opencode']);
  });

  it('.cmd 经 cmd.exe 启动，路径中的空格与括号在引号内', () => {
    const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
    expect(windows.commandFor('C:\\Program Files (x86)\\npm\\opencode.cmd', ['--version'], env)).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files (x86)\\npm\\opencode.cmd" --version"'],
      windowsVerbatimArguments: true,
    });
    expect(windows.commandFor('C:\\oc\\opencode.exe', ['serve'], env)).toEqual({
      file: 'C:\\oc\\opencode.exe',
      args: ['serve'],
      windowsVerbatimArguments: false,
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
