import { OPERATION_CONTRACTS } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { OPERATION_TITLE } from './operations.ts';

describe('操作标题文案', () => {
  it('每个操作契约的 title 都有文案', () => {
    const missing = OPERATION_CONTRACTS.map((op) => op.title).filter((title) => OPERATION_TITLE[title] === undefined);
    expect(missing).toEqual([]);
  });
});
