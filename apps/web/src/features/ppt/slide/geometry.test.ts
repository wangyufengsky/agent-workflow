import { describe, expect, it } from 'vitest';
import { emphasisRuns } from './geometry.ts';

describe('emphasisRuns', () => {
  it('拆出 **强调**，其余为普通文字', () => {
    expect(emphasisRuns('分页把接口降到 **200 ms**，导出不再超时')).toEqual([
      { text: '分页把接口降到 ', strong: false },
      { text: '200 ms', strong: true },
      { text: '，导出不再超时', strong: false },
    ]);
  });

  it('没有标记或标记不成对时按原文显示', () => {
    expect(emphasisRuns('普通文字')).toEqual([{ text: '普通文字', strong: false }]);
    expect(emphasisRuns('**开头')).toEqual([{ text: '开头', strong: true }]);
  });
});
