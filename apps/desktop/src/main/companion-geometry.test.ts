import { expect, it } from 'vitest';
import { fitCompanion } from './companion-geometry.ts';

it('移除显示器或缩小工作区后，整个桌宠窗口仍可操作', () => {
  expect(
    fitCompanion({ x: 1900, y: 1100, width: 460, height: 680 }, { x: 0, y: 24, width: 1280, height: 776 }),
  ).toEqual({ x: 820, y: 120, width: 460, height: 680 });
  expect(
    fitCompanion({ x: -1200, y: -500, width: 460, height: 680 }, { x: -800, y: 0, width: 800, height: 600 }),
  ).toEqual({ x: -800, y: 0, width: 460, height: 600 });
});
