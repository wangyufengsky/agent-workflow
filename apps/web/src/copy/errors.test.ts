import { ERROR_CODES } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { ERROR_COPY } from './errors.ts';

describe('错误文案', () => {
  it('错误码表与文案表的键一致，且文案不为空', () => {
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.values(ERROR_COPY).filter((text) => text.trim() === '')).toEqual([]);
  });
});
