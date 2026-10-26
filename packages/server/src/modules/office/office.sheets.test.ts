import { ATTACHMENT_READ_MAX_CHARS, ErrorCode, type QuerySheetInput } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { querySheet, readSheetPage, type SheetQuery, sheetPreview } from './office.sheets.ts';
import type { Workbook, WorkbookRow } from './office.workbook.ts';

const row = (r: number, ...values: Array<string | number | null>): WorkbookRow => ({
  r,
  hidden: false,
  cells: values.flatMap((v, i) => (v === null ? [] : [{ c: i + 1, v }])),
});

const sales: Workbook = {
  sheets: [
    {
      name: '明细',
      hidden: false,
      range: 'A1:D6',
      merges: [],
      hiddenColumns: [],
      rows: [
        row(1, '日期', '区域', '产品', '金额'),
        row(2, '2026-09-01', '华东', 'A100', 420),
        row(3, '2026-09-02', '华北', 'B200', 602.5),
        row(4, '2026-09-03', '华东', 'B200', 964),
        row(5, '2026-09-04', '华南', 'A100', '700'),
        row(6, '2026-09-05', null, 'A100', 105),
      ],
    },
  ],
};

const query = (q: Partial<SheetQuery>): SheetQuery => ({
  sheet: '明细',
  header_row: 1,
  where: [],
  group_by: [],
  aggregates: [],
  order_by: [],
  limit: 100,
  ...q,
});
const errorOf = (work: () => unknown) => {
  try {
    work();
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('No error');
};

describe('read_sheet 的分页', () => {
  it('按行读出区域里有内容的行，值与列字母对齐；可以带上公式', () => {
    const workbook: Workbook = {
      sheets: [
        {
          ...(sales.sheets[0] as Workbook['sheets'][number]),
          rows: [row(1, '金额'), { r: 3, hidden: true, cells: [{ c: 2, v: 2, f: 'A1*2' }] }],
        },
      ],
    };
    expect(readSheetPage(workbook, { sheet: '明细', range: 'A1:B4', include_formulas: true })).toEqual({
      sheet: '明细',
      range: 'A1:B3',
      columns: ['A', 'B'],
      rows: [
        { row: 1, hidden: false, values: ['金额', null], formulas: {} },
        { row: 3, hidden: true, values: [null, 2], formulas: { B: 'A1*2' } },
      ],
      next_range: null,
    });
  });

  it('一页约 ATTACHMENT_READ_MAX_CHARS 字符，不切断行；next_range 接着读完，最后一页为 null', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(i + 1, i + 1));
    const workbook: Workbook = {
      sheets: [{ name: 'S', hidden: false, range: 'A1:A1000', merges: [], hiddenColumns: [], rows }],
    };
    const read: number[] = [];
    let range: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = readSheetPage(workbook, { sheet: 'S', range, include_formulas: false });
      expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(ATTACHMENT_READ_MAX_CHARS);
      read.push(...result.rows.map((r) => r.row));
      if (result.next_range === null) break;
      expect(result.next_range).toBe(`A${(read.at(-1) as number) + 1}:A1000`);
      range = result.next_range;
    }
    expect(read).toEqual(rows.map((r) => r.r));
  });

  it('长单元格按字符数分页，至少给一行', () => {
    const long = 'x'.repeat(ATTACHMENT_READ_MAX_CHARS);
    const workbook: Workbook = {
      sheets: [
        { name: 'S', hidden: false, range: 'A1:A2', merges: [], hiddenColumns: [], rows: [row(1, long), row(2, long)] },
      ],
    };
    const page = readSheetPage(workbook, { sheet: 'S', include_formulas: false });
    expect([page.rows.length, page.next_range]).toEqual([1, 'A2:A2']);
  });

  it('没有这个工作表时列出现有的', () => {
    expect(errorOf(() => readSheetPage(sales, { sheet: '汇总', include_formulas: false }))).toMatchObject({
      code: ErrorCode.ValidationFailed,
      message: 'No sheet named "汇总"; the sheets are "明细"',
    });
  });
});

describe('query_sheet', () => {
  it('按表头或列字母选列、筛选、排序、限制行数，total_rows 是限制前的行数', () => {
    expect(
      querySheet(
        sales,
        query({
          columns: ['日期', 'D'],
          where: [
            { column: '产品', op: 'eq', value: 'A100' },
            { column: '金额', op: 'gte', value: 105 },
          ],
          order_by: [{ column: '金额', desc: true }],
          limit: 2,
        }),
      ),
    ).toEqual({
      sheet: '明细',
      columns: ['日期', '金额'],
      rows: [
        ['2026-09-04', '700'],
        ['2026-09-01', 420],
      ],
      total_rows: 3,
    });
  });

  it('分组汇总：sum / avg 只算数字（文字里的数字也算），count 不带列时数行、带列时数非空', () => {
    const result = querySheet(
      sales,
      query({
        group_by: ['区域'],
        aggregates: [{ fn: 'sum', column: '金额' }, { fn: 'count' }, { fn: 'count', column: '区域' }],
        order_by: [{ column: 'sum(金额)', desc: true }],
      }),
    );
    expect(result.columns).toEqual(['区域', 'sum(金额)', 'count', 'count(区域)']);
    expect(result.rows).toEqual([
      ['华东', 1384, 2, 2],
      ['华南', 700, 1, 1],
      ['华北', 602.5, 1, 1],
      [null, 105, 1, 0],
    ]);
  });

  it('不分组时对全部匹配的行汇总一次，日期按文字比较', () => {
    const result = querySheet(
      sales,
      query({
        where: [{ column: '日期', op: 'lt', value: '2026-09-03' }],
        aggregates: [
          { fn: 'avg', column: '金额' },
          { fn: 'max', column: '日期' },
        ],
      }),
    );
    expect(result.rows).toEqual([[511.25, '2026-09-02']]);
  });

  it('in、contains、empty', () => {
    const regions = (where: QuerySheetInput['where']) =>
      querySheet(sales, query({ columns: ['区域'], where })).rows.flat();
    expect(regions([{ column: '区域', op: 'in', value: ['华北', '华南'] }])).toEqual(['华北', '华南']);
    expect(regions([{ column: '产品', op: 'contains', value: 'B2' }])).toEqual(['华北', '华东']);
    expect(regions([{ column: '区域', op: 'empty' }])).toEqual([null]);
  });

  it('列名不对、分组没有汇总、排序列不在结果里时说明怎么改', () => {
    expect(errorOf(() => querySheet(sales, query({ where: [{ column: '城市', op: 'empty' }] }))).message).toBe(
      'No column "城市"; the columns are "日期", "区域", "产品", "金额"',
    );
    expect(errorOf(() => querySheet(sales, query({ group_by: ['区域'] }))).message).toBe(
      'group_by needs at least one aggregate',
    );
    expect(
      errorOf(() => querySheet(sales, query({ columns: ['区域'], order_by: [{ column: '金额', desc: false }] })))
        .message,
    ).toBe('"金额" is not a returned column; they are 区域');
  });

  it('不指定列时按位置返回所有列，表头重名的两列各是各的', () => {
    const twins: Workbook = {
      sheets: [
        {
          name: 'S',
          hidden: false,
          range: 'A1:B2',
          merges: [],
          hiddenColumns: [],
          rows: [row(1, '金额', '金额'), row(2, 10, 20)],
        },
      ],
    };
    expect(querySheet(twins, query({ sheet: 'S' }))).toMatchObject({ columns: ['金额', '金额'], rows: [[10, 20]] });
  });

  it('十万行的汇总不随行数平方变慢', () => {
    const rows = [row(1, '金额'), ...Array.from({ length: 100_000 }, (_, i) => row(i + 2, 1))];
    const big: Workbook = {
      sheets: [{ name: 'S', hidden: false, range: 'A1:A100001', merges: [], hiddenColumns: [], rows }],
    };
    const started = performance.now();
    expect(querySheet(big, query({ sheet: 'S', aggregates: [{ fn: 'sum', column: '金额' }] })).rows).toEqual([
      [100_000],
    ]);
    // Far below the worker's time limit; quadratic grouping took over 30 s for 30,000 rows.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('预览', () => {
  it('前几行原样给出；文件没存结果的公式带上公式，有结果的只给值', () => {
    const workbook: Workbook = {
      sheets: [
        {
          name: 'S',
          hidden: false,
          range: 'A1:B3',
          merges: [],
          hiddenColumns: [],
          rows: [
            row(1, '金额', '合计'),
            {
              r: 2,
              hidden: false,
              cells: [
                { c: 1, v: 1 },
                { c: 2, v: 3, f: 'A2+A3' },
              ],
            },
            {
              r: 3,
              hidden: true,
              cells: [
                { c: 1, v: 2 },
                { c: 2, v: null, f: 'A3*2' },
              ],
            },
          ],
        },
      ],
    };
    expect(sheetPreview(workbook, 'S', 2)).toMatchObject({ totalRows: 3, rows: [{ r: 1 }, { r: 2 }] });
    expect(
      sheetPreview(workbook, 'S', 3)
        .rows.slice(1)
        .map((r) => r.cells),
    ).toEqual([
      [
        { c: 1, v: 1 },
        { c: 2, v: 3 },
      ],
      [
        { c: 1, v: 2 },
        { c: 2, v: null, f: 'A3*2' },
      ],
    ]);
  });
});
