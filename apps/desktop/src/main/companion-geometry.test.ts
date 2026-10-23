import { expect, it } from 'vitest';
import { placeCompanion } from './companion-geometry.ts';

it('角色可以移出屏幕一部分，但移除显示器后仍保留 64px 可拖回区域', () => {
  const placed = placeCompanion(
    { x: 1900, y: 1100, width: 180, height: 216 },
    { x: 0, y: 24, width: 1280, height: 776 },
    'none',
  );
  expect(placed.anchor).toEqual({ x: 1216, y: 736, width: 180, height: 216 });
  expect(placed.bounds).toEqual({ x: 1171, y: 691, width: 109, height: 109 });
  const left = placeCompanion(
    { x: -1200, y: -500, width: 180, height: 216 },
    { x: -800, y: 0, width: 800, height: 600 },
    'none',
  );
  expect(left.anchor).toEqual({ x: -916, y: -152, width: 180, height: 216 });
  expect(left.bounds).toEqual({ x: -800, y: 0, width: 109, height: 109 });
});

it('收起窗口为光晕与跳跃留出绘制余量，角色仍以自身坐标定位', () => {
  const { bounds, layout } = placeCompanion(
    { x: 500, y: 300, width: 180, height: 216 },
    { x: 0, y: 24, width: 1280, height: 776 },
    'none',
  );
  expect(bounds).toEqual({ x: 455, y: 255, width: 270, height: 306 });
  expect(layout.actor).toEqual({ x: 45, y: 45, width: 180, height: 216 });
});

it.each([
  [8, 32, 'below'],
  [1092, 568, 'above'],
  [8, 300, 'right'],
  [1092, 300, 'left'],
])('位于 (%i,%i) 时面板向 %s 展开，不挪动角色', (x, y, side) => {
  const actor = { x, y, width: 180, height: 216 };
  const { anchor, bounds, layout } = placeCompanion(actor, { x: 0, y: 24, width: 1280, height: 776 }, 'chat');
  expect(anchor).toEqual(actor);
  expect(layout.side).toBe(side);
  expect(layout.actor.x + bounds.x).toBe(x);
  expect(layout.actor.y + bounds.y).toBe(y);
  expect(layout.panel?.width).toBe(400);
  expect(layout.panel?.height).toBe(440);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(24);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
});

it('极小工作区让面板在屏幕内滚动，仍保留角色原位置', () => {
  const actor = { x: 120, y: 60, width: 180, height: 216 };
  const { anchor, bounds, layout } = placeCompanion(actor, { x: 0, y: 0, width: 320, height: 360 }, 'chat');
  expect(anchor).toEqual(actor);
  expect(bounds).toEqual({ x: 0, y: 0, width: 320, height: 360 });
  expect(layout.panel).toEqual(bounds);
});
