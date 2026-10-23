import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { axNodeSchema, formatSnapshot } from './browser.snapshot.ts';

// Recorded from Chromium on test/fixtures/browser/orders.html (07 §1: real output, not a hand-made tree).
const ORDERS = JSON.parse(
  readFileSync(new URL('../../../test/fixtures/browser/orders.ax.json', import.meta.url), 'utf8'),
).map((node: unknown) => axNodeSchema.parse(node));

describe('formatSnapshot', () => {
  it('结构与可操作元素一行一个，可操作的带编号，编号对应 DOM 节点', () => {
    const { text, refs } = formatSnapshot(ORDERS, 12_000);
    expect(text.split('\n').slice(0, 10)).toEqual([
      'navigation "主导航"',
      '  link "首页" [ref=e1]',
      '  link "退款单" [ref=e2]',
      'main',
      '  heading "退款单" [level=1]',
      '  "按订单号搜索退款记录。"',
      '  searchbox "搜索订单号" value="" [ref=e3]',
      '  button "导出" [ref=e4]',
      '  checkbox "只看已退款" checked [ref=e5]',
      '  combobox "状态" value="全部" [ref=e6] (3 个选项)',
    ]);
    expect(text).toContain('    button "上一页" disabled [ref=e7]');
    expect(refs.size).toBe(8);
    expect(refs.get('e4')).toBe(
      ORDERS.find((n: { name?: { value?: unknown } }) => n.name?.value === '导出')?.backendDOMNodeId,
    );
  });

  it('表格的一行压成一条，隐藏的内容不出现', () => {
    const { text } = formatSnapshot(ORDERS, 12_000);
    expect(text).toContain('  table "退款单列表"\n    row "单号 · 客户 · 金额"\n    row "R-1001 · 张三 · ¥120.00"');
    expect(text).not.toContain('隐藏的内容');
  });

  it('放不下时先只留每个列表与表格的前 5 项，再截掉末尾并注明', () => {
    const rowsCut = formatSnapshot(ORDERS, 520).text;
    expect(rowsCut).toContain('    row "R-1005 · 钱七 · ¥12.00"\n    …（共 7 项，只显示前 5 项）');
    expect(rowsCut).not.toContain('R-1006');
    expect(rowsCut.length).toBeLessThanOrEqual(520);

    const tailCut = formatSnapshot(ORDERS, 250).text;
    expect(tailCut.length).toBeLessThanOrEqual(250);
    expect(tailCut).toMatch(/…（截断：省略了后面 \d+ 行）$/);
  });
});
