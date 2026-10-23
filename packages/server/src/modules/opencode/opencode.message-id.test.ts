import { expect, it } from 'vitest';
import { createMessageId } from './opencode.message-id.ts';

it('显式消息 id 符合固定版本格式，同毫秒仍按生成顺序排序', () => {
  const first = createMessageId(1_792_780_000_000);
  const second = createMessageId(1_792_780_000_000);
  const next = createMessageId(1_792_780_000_001);
  expect(first).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  expect([next, first, second].sort()).toEqual([first, second, next]);
  expect(new Set([first, second, next]).size).toBe(3);
});
