import { expect, it } from 'vitest';
import { calibrate } from './budget.ts';

it('用实测文本 token 校准，媒体单算；外部工具用相邻斜率消除固定体积', () => {
  expect(calibrate({ bytes: 12000, tokens: 3000 }, undefined, false)).toBe(4);
  expect(calibrate({ bytes: 18000, tokens: 12000 }, { bytes: 10000, tokens: 10000 }, true)).toBe(4);
  expect(calibrate({ bytes: 18000, tokens: 12000 }, { bytes: 17000, tokens: 11000 }, true)).toBeUndefined();
  expect(calibrate({ bytes: 1000, tokens: 2000 }, undefined, false)).toBe(1.5);
  expect(calibrate({ bytes: 10000, tokens: 100 }, undefined, false)).toBe(6);
});
