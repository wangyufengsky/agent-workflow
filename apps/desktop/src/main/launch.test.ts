import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SYSTEM_THEME_MAP, ThemeId } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { readLaunchPreferences, writeLaunchPreferences } from './launch.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'aw-launch-')), 'launch.json');

describe('launch.json（28 §5.3）', () => {
  it('首次启动按系统外观选主题并播放动画', () => {
    expect(readLaunchPreferences(file(), true)).toEqual({ theme: SYSTEM_THEME_MAP.dark, intro: true });
    expect(readLaunchPreferences(file(), false)).toEqual({ theme: SYSTEM_THEME_MAP.light, intro: true });
  });

  it('读回上次留下的主题与开关', () => {
    const path = file();
    writeLaunchPreferences(path, { theme: ThemeId.Warm, intro: false });
    expect(readLaunchPreferences(path, true)).toEqual({ theme: ThemeId.Warm, intro: false });
  });

  it('文件损坏或内容不对时按首次启动处理', () => {
    const broken = file();
    writeFileSync(broken, '{"theme":');
    expect(readLaunchPreferences(broken, false)).toEqual({ theme: SYSTEM_THEME_MAP.light, intro: true });
    const unknown = file();
    writeFileSync(unknown, JSON.stringify({ theme: 'neon', intro: true }));
    expect(readLaunchPreferences(unknown, true)).toEqual({ theme: SYSTEM_THEME_MAP.dark, intro: true });
  });

  it('拒绝写入不合法的偏好（来自 IPC）', () => {
    expect(() => writeLaunchPreferences(file(), { theme: ThemeId.Warm })).toThrow();
  });
});
