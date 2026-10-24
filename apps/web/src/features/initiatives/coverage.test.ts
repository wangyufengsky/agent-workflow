import { describe, expect, it } from 'vitest';
import { coverageLines } from './coverage.ts';

describe('需求覆盖表（34 §5.2）', () => {
  it('按当前的工作包对照：删掉的工作包不再算覆盖，AI 标为不做的点照旧', () => {
    const items = [{ key: 'order', title: '订单测试' }];
    const coverage = [
      { point: '订单有测试', items: ['order', 'payment'] },
      { point: '支付有测试', items: ['payment'] },
      { point: '性能测试', items: [] },
    ];
    expect(coverageLines(coverage, items)).toEqual({
      covered: 1,
      lines: [
        { point: '订单有测试', state: 'covered', titles: ['订单测试'] },
        { point: '支付有测试', state: 'removed', titles: [] },
        { point: '性能测试', state: 'skipped', titles: [] },
      ],
    });
  });
});
