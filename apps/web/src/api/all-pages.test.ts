import { describe, expect, it } from 'vitest';
import { allPages } from './all-pages.ts';

describe('allPages', () => {
  it('跟着 nextCursor 读完每一页，按顺序拼起来', async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
      start: { items: [1, 2], nextCursor: 'b' },
      b: { items: [3, 4], nextCursor: 'c' },
      c: { items: [5], nextCursor: null },
    };
    const asked: Array<string | undefined> = [];
    const items = await allPages(async (cursor) => {
      asked.push(cursor);
      return pages[cursor ?? 'start'] ?? { items: [], nextCursor: null };
    });
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(asked).toEqual([undefined, 'b', 'c']);
  });
});
