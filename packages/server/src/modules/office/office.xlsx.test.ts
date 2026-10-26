import { columnName } from '@aw/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readXlsx } from './office.xlsx.ts';
import { zipEntries } from './office.zip.ts';

/** A workbook as a program (not Excel) writes it: formulas without cached results. */
async function written(build: (book: ExcelJS.Workbook) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  build(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('Excel 读成工作簿与文字', () => {
  it('取单元格的值：日期为 ISO、富文本取文字、公式取缓存结果，没有缓存时文字里写公式', async () => {
    const bytes = await written((book) => {
      const sheet = book.addWorksheet('明细');
      sheet.addRow(['日期', '说明', '金额', '合计']);
      sheet.addRow([
        new Date('2026-09-01T00:00:00Z'),
        { richText: [{ text: '含税' }, { text: ' | 元' }] },
        { formula: '1+1', result: 2 },
        { formula: 'C2*2' },
      ]);
      sheet.addRow([new Date('2026-09-01T08:30:00Z'), '多行\n说明', null, null]);
    });
    const { workbook, text, meta } = await readXlsx(bytes, zipEntries(bytes));
    expect(workbook.sheets[0]?.rows[1]?.cells).toEqual([
      { c: 1, v: '2026-09-01' },
      { c: 2, v: '含税 | 元' },
      { c: 3, v: 2, f: '1+1' },
      { c: 4, v: null, f: 'C2*2' },
    ]);
    expect(text).toContain('| 2 | 2026-09-01 | 含税 \\| 元 | 2 | =C2*2 |');
    expect(text).toContain('| 3 | 2026-09-01T08:30:00 | 多行<br>说明 |  |  |');
    expect(meta).toMatchObject({ format: 'xlsx', formulas: 2, sheets: [{ name: '明细', range: 'A1:D3', rows: 3 }] });
  });

  it('行号与列字母从数据所在的位置开始；合并区域只记一次，隐藏的行、列、工作表都标出', async () => {
    const bytes = await written((book) => {
      const sheet = book.addWorksheet('汇总');
      sheet.getCell('C3').value = '区域汇总';
      sheet.mergeCells('C3:D3');
      sheet.getCell('C4').value = '华东';
      sheet.getCell('D4').value = 1384;
      sheet.getRow(4).hidden = true;
      sheet.getColumn('D').hidden = true;
      book.addWorksheet('空的');
      book.addWorksheet('内部', { state: 'hidden' }).getCell('A1').value = 1;
    });
    const { workbook, text, meta } = await readXlsx(bytes, zipEntries(bytes));
    expect(workbook.sheets[0]).toMatchObject({ range: 'C3:D4', merges: ['C3:D3'], hiddenColumns: [4] });
    expect(text).toContain(
      [
        '## 工作表「汇总」（C3:D4，2 行 × 2 列）',
        '合并单元格：C3:D3',
        '隐藏的列：D',
        '',
        '| 行 | C | D |',
        '| --- | --- | --- |',
        '| 3 | 区域汇总 |  |',
        '| 4（隐藏） | 华东 | 1384 |',
      ].join('\n'),
    );
    expect(text).toContain('## 工作表「空的」（空）');
    expect(text).toContain('## 工作表「内部」（A1:A1，1 行 × 1 列，隐藏的工作表）');
    expect(meta).toMatchObject({ sheets: [{ hidden: false }, { range: null, rows: 0 }, { hidden: true }] });
  });

  it('列字母', () => {
    expect([1, 26, 27, 52, 703].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
  });

  it('跨很多列的稀疏工作表逐个列出单元格，文字随单元格数增长而不是行数乘列数', async () => {
    const bytes = await written((book) => {
      const sheet = book.addWorksheet('稀疏');
      for (let r = 1; r <= 1000; r++) sheet.getCell(`A${r}`).value = r;
      sheet.getCell('XFD1').value = '备注';
    });
    const { text } = await readXlsx(bytes, zipEntries(bytes));
    expect(text).toContain('## 工作表「稀疏」（A1:XFD1000，1000 行 × 16384 列）');
    expect(text).toContain('- 1：A1 = 1；XFD1 = 备注\n- 2：A2 = 2\n');
    expect(text.length).toBeLessThan(20_000);
  });

  it('提示词里的概览：每个工作表只放前 10 行与最后 2 行，中间写省略了几行；说明公式与没读的图表', async () => {
    const bytes = await written((book) => {
      const sheet = book.addWorksheet('明细');
      sheet.addRow(['序号', '金额']);
      for (let i = 1; i <= 20; i++) sheet.addRow([i, { formula: `A${i + 1}*10`, result: i * 10 }]);
    });
    const { overview } = await readXlsx(bytes, [
      ...zipEntries(bytes),
      { name: 'xl/charts/chart1.xml', method: 8, compressedSize: 0, size: 0, localOffset: 0 },
    ]);
    expect(overview).toContain('## 工作表「明细」（A1:B21，21 行 × 2 列；下面是前 10 行与最后 2 行）');
    expect(overview).toContain('| 10 | 9 | 90 |\n| … | 省略 9 行 | |\n| 20 | 19 | 190 |');
    expect(overview).not.toContain('| 11 |');
    expect(overview).toContain('有 20 个公式，显示的是文件里保存的结果；1 个图表没有读取。');
  });

  it('概览开头列出全部工作表，即使后面被截断也能知道还有哪些表可读', async () => {
    const bytes = await written((book) => {
      book.addWorksheet('长文本').getCell('A1').value = 'x'.repeat(13_000);
      book.addWorksheet('第二张').getCell('A1').value = 1;
      book.addWorksheet('内部', { state: 'hidden' });
    });
    const { overview } = await readXlsx(bytes, zipEntries(bytes));
    expect(overview.split('\n')[0]).toBe(
      '共 3 个工作表：「长文本」（A1:A1）、「第二张」（A1:A1）、「内部」（空，隐藏）',
    );
  });
});
