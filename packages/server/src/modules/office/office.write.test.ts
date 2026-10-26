import { createXlsxInputSchema, OFFICE_WRITE_CELLS_MAX } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { readDocx } from './office.docx.ts';
import type { Workbook } from './office.workbook.ts';
import { sourceRows, writeDocx, writeXlsx } from './office.write.ts';
import { readXlsx } from './office.xlsx.ts';
import { zipEntries } from './office.zip.ts';

describe('生成 Word', () => {
  it('标题、段落里的强调与链接、有序与无序列表、表格写进去后能原样读回', async () => {
    const bytes = await writeDocx({
      title: '周报',
      blocks: [
        { type: 'heading', level: 1, text: '本周进展' },
        { type: 'paragraph', text: '完成了**订单导出**，*退款*下周做，见[说明](https://e.com/spec)。' },
        { type: 'list', ordered: true, items: ['筛选', '导出'] },
        { type: 'list', ordered: false, items: ['风险：数据量大'] },
        {
          type: 'table',
          header: ['区域', '金额'],
          rows: [
            ['华东', '1384'],
            ['华北', '707.5 | 含税'],
          ],
        },
        { type: 'page_break' },
        { type: 'heading', level: 2, text: '下周' },
      ],
    });
    const { text, meta } = await readDocx(bytes);
    expect(text).toContain('# 本周进展');
    expect(text).toContain('完成了**订单导出**，*退款*下周做，见[说明](https://e.com/spec)。');
    expect(text).toContain('1. 筛选\n2. 导出');
    expect(text).toContain('- 风险：数据量大');
    // The header row is written bold.
    expect(text).toContain('| **区域** | **金额** |\n| --- | --- |\n| 华东 | 1384 |\n| 华北 | 707.5 \\| 含税 |');
    expect(text).toContain('## 下周');
    expect(meta).toMatchObject({ headings: 2, tables: 1 });
  });
});

describe('生成 Excel', () => {
  it('表头加粗冻结；日期、数字、公式按类型写入；以 = 开头的文字仍是文字', async () => {
    const [sheet] = createXlsxInputSchema.parse({
      file: '汇总.xlsx',
      sheets: [
        {
          name: '汇总',
          columns: [{ header: '日期', type: 'date' }, { header: '区域' }, { header: '金额', type: 'currency' }],
          rows: [
            [{ date: '2026-09-01' }, '华东', 1384],
            [{ date: '2026-09-02' }, '=1+1', 707.5],
            [null, '合计', { formula: '=SUM(C2:C3)' }],
          ],
        },
      ],
    }).sheets;
    const bytes = await writeXlsx([sheet as NonNullable<typeof sheet>], async () => undefined);
    const { workbook } = await readXlsx(bytes, zipEntries(bytes));
    expect(workbook.sheets[0]?.rows.map((r) => r.cells)).toEqual([
      [
        { c: 1, v: '日期' },
        { c: 2, v: '区域' },
        { c: 3, v: '金额' },
      ],
      [
        { c: 1, v: '2026-09-01' },
        { c: 2, v: '华东' },
        { c: 3, v: 1384 },
      ],
      [
        { c: 1, v: '2026-09-02' },
        { c: 2, v: '=1+1' },
        { c: 3, v: 707.5 },
      ],
      // Excel computes it on opening; the file saves no result.
      [
        { c: 2, v: '合计' },
        { c: 3, v: null, f: 'SUM(C2:C3)' },
      ],
    ]);
  });

  it('rows_from 把查询结果整张写入，表头是结果的列名', async () => {
    const source: Workbook = {
      sheets: [
        {
          name: '明细',
          hidden: false,
          range: 'A1:B4',
          merges: [],
          hiddenColumns: [],
          rows: [
            {
              r: 1,
              hidden: false,
              cells: [
                { c: 1, v: '区域' },
                { c: 2, v: '金额' },
              ],
            },
            {
              r: 2,
              hidden: false,
              cells: [
                { c: 1, v: '华东' },
                { c: 2, v: 420 },
              ],
            },
            {
              r: 3,
              hidden: false,
              cells: [
                { c: 1, v: '华北' },
                { c: 2, v: 602.5 },
              ],
            },
            {
              r: 4,
              hidden: false,
              cells: [
                { c: 1, v: '华东' },
                { c: 2, v: 964 },
              ],
            },
          ],
        },
      ],
    };
    const { sheets } = createXlsxInputSchema.parse({
      file: '按区域.xlsx',
      sheets: [
        {
          name: '按区域',
          rows_from: {
            attachment_id: 'a1',
            sheet: '明细',
            group_by: ['区域'],
            aggregates: [{ fn: 'sum', column: '金额' }],
            order_by: [{ column: 'sum(金额)', desc: true }],
          },
        },
      ],
    });
    const bytes = await writeXlsx(sheets, async ({ rows_from }) =>
      rows_from === undefined ? undefined : sourceRows(source, rows_from),
    );
    const { text } = await readXlsx(bytes, zipEntries(bytes));
    expect(text).toContain('| 1 | 区域 | sum(金额) |\n| 2 | 华东 | 1384 |\n| 3 | 华北 | 602.5 |');
  });
});

describe('create_xlsx 的输入', () => {
  const sheet = (extra: Record<string, unknown>) => ({ name: 'S', columns: [{ header: 'A' }], ...extra });
  const problems = (input: unknown) =>
    createXlsxInputSchema.safeParse(input).error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [];

  it('拒绝会联网、引用外部工作簿或 DDE 的公式', () => {
    for (const formula of [
      'WEBSERVICE("https://x")',
      'HYPERLINK("http://x","a")',
      '[1]Sheet1!A1',
      "cmd|' /C calc'!A0",
    ]) {
      expect(problems({ file: 'x.xlsx', sheets: [sheet({ rows: [[{ formula }]] })] })).toEqual([
        'sheets.0.rows.0.0.formula: external references, DDE and functions that reach the network are not allowed',
      ]);
    }
  });

  it('rows 与 rows_from 二选一；工作表不能重名；一行不能多于列数；文件扩展名要对', () => {
    expect(problems({ file: 'x.xlsx', sheets: [{ name: 'S', columns: [{ header: 'A' }] }] })).toEqual([
      'sheets.0.rows: give either rows or rows_from',
    ]);
    expect(problems({ file: 'x.xlsx', sheets: [sheet({ rows: [] }), sheet({ name: 's', rows: [] })] })).toEqual([
      'sheets.1.name: repeated',
    ]);
    expect(problems({ file: 'x.xlsx', sheets: [sheet({ rows: [[1, 2]] })] })).toEqual([
      'sheets.0.rows.0: has 2 cells for 1 columns',
    ]);
    expect(problems({ file: 'x.docx', sheets: [sheet({ rows: [] })] })).toEqual(['file: must end with .xlsx']);
  });
});

describe('rows_from 的上限', () => {
  it('匹配的行超过单元格上限时拒绝，不悄悄截掉', () => {
    const rows = Array.from({ length: OFFICE_WRITE_CELLS_MAX + 1 }, (_, i) => ({
      r: i + 2,
      hidden: false,
      cells: [{ c: 1, v: i }],
    }));
    const big: Workbook = {
      sheets: [
        {
          name: 'S',
          hidden: false,
          range: `A1:A${rows.length + 1}`,
          merges: [],
          hiddenColumns: [],
          rows: [{ r: 1, hidden: false, cells: [{ c: 1, v: '序号' }] }, ...rows],
        },
      ],
    };
    const query = {
      attachment_id: 'a',
      sheet: 'S',
      header_row: 1,
      where: [],
      group_by: [],
      aggregates: [],
      order_by: [],
    };
    expect(() => sourceRows(big, query)).toThrow(/rows_from matches 200001 rows/);
  });
});
