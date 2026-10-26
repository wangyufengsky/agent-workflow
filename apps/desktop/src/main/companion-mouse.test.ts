import { describe, expect, it } from 'vitest';
import { companionMouse } from './companion-mouse.ts';

describe('桌宠窗口的鼠标（D192）', () => {
  it('Linux 上始终接收鼠标：一开始，以及渲染端说指针离开之后', () => {
    expect(companionMouse('linux', false)).toEqual({ ignore: false, forward: false });
    expect(companionMouse('linux', true)).toEqual({ ignore: false, forward: false });
  });

  it('macOS 与 Windows 平时穿透并转发指针移动，悬停在可交互处时接收鼠标', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(companionMouse(platform, false)).toEqual({ ignore: true, forward: true });
      expect(companionMouse(platform, true)).toEqual({ ignore: false, forward: false });
    }
  });
});
