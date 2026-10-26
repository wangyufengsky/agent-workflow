import { readFile } from 'node:fs/promises';
import { ErrorCode, type XlsxEdit } from '@aw/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeZip } from '../../../test/helpers/zip.ts';
import { readDocx } from './office.docx.ts';
import { editXlsx, reviseDocx } from './office.edit.ts';
import { writeDocx } from './office.write.ts';
import { readZipEntry, zipEntries } from './office.zip.ts';

const fixture = (name: string) => readFile(new URL(`../../../test/fixtures/office/${name}`, import.meta.url));

/** The zip with `extra` parts added and `replace` parts swapped, as another program might have written it. */
function repacked(bytes: Buffer, extra: Record<string, string>, replace: Record<string, string> = {}): Buffer {
  const parts = zipEntries(bytes).map((entry) => ({
    name: entry.name,
    content: replace[entry.name] ?? readZipEntry(bytes, entry, 64 * 1024 * 1024),
  }));
  return makeZip([...parts, ...Object.entries(extra).map(([name, content]) => ({ name, content }))]);
}

const loaded = async (bytes: Buffer) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return book;
};

describe('edit_xlsx', () => {
  it('在副本上按顺序修改，原有的样式、合并、隐藏的工作表都在；移动了行时报告公式引用没有调整', async () => {
    const source = await fixture('sales.libreoffice.xlsx');
    const operations: XlsxEdit[] = [
      { op: 'set_cells', sheet: '明细', start: 'G1', values: [['备注'], ['加急']] },
      { op: 'rename_sheet', sheet: '汇总', name: '区域汇总' },
      { op: 'insert_rows', sheet: '区域汇总', before: 2, count: 1 },
      { op: 'add_sheet', name: '说明' },
      { op: 'set_cells', sheet: '说明', start: 'A1', values: [[{ date: '2026-10-26' }, { formula: '=1+1' }]] },
    ];
    const { bytes, lost } = await editXlsx(source, operations);
    expect(lost).toEqual([{ kind: 'formula_references', count: 9 }]);
    const book = await loaded(bytes);
    expect(book.worksheets.map((s) => [s.name, s.state])).toEqual([
      ['明细', 'visible'],
      ['区域汇总', 'visible'],
      ['隐藏', 'hidden'],
      ['说明', 'visible'],
    ]);
    const detail = book.getWorksheet('明细') as ExcelJS.Worksheet;
    expect([detail.getCell('G2').value, detail.getCell('F2').value]).toMatchObject(['加急', { result: 420 }]);
    expect(detail.getCell('A1').font?.bold).toBe(true);
    const totals = book.getWorksheet('区域汇总') as ExcelJS.Worksheet;
    expect(totals.getCell('A4').value).toBe('华东');
    expect(totals.model.merges).toEqual(['A1:B1']);
    expect((book.getWorksheet('说明') as ExcelJS.Worksheet).getCell('B1').value).toEqual({ formula: '1+1' });
  });

  it('原件里 exceljs 保留不了的图表与透视表报告为丢失', async () => {
    const source = repacked(await fixture('sales.libreoffice.xlsx'), {
      'xl/charts/chart1.xml': '<c:chartSpace/>',
      'xl/pivotTables/pivotTable1.xml': '<pivotTableDefinition/>',
    });
    const { lost } = await editXlsx(source, [{ op: 'set_cells', sheet: '明细', start: 'A1', values: [['日期']] }]);
    expect(lost).toEqual([
      { kind: 'charts', count: 1 },
      { kind: 'pivot_tables', count: 1 },
    ]);
  });

  it('工作表不存在、重名、删掉最后一个工作表时说明', async () => {
    const source = await fixture('sales.libreoffice.xlsx');
    const errorOf = (operations: XlsxEdit[]) =>
      editXlsx(source, operations).then(
        () => undefined,
        (err: { code: string; message: string; details: unknown }) => [err.code, err.message, err.details],
      );
    expect(await errorOf([{ op: 'delete_rows', sheet: '没有', from: 1, count: 1 }])).toEqual([
      ErrorCode.ValidationFailed,
      'No sheet named "没有"; the sheets are "明细", "汇总", "隐藏"',
      {
        issues: [
          {
            path: ['operations', '0', 'sheet'],
            message: 'No sheet named "没有"; the sheets are "明细", "汇总", "隐藏"',
          },
        ],
      },
    ]);
    expect((await errorOf([{ op: 'add_sheet', name: '明细' }]))?.[1]).toBe('A sheet named "明细" exists already');
    const only = await errorOf([
      { op: 'delete_sheet', sheet: '汇总' },
      { op: 'delete_sheet', sheet: '隐藏' },
      { op: 'delete_sheet', sheet: '明细' },
    ]);
    expect(only?.[1]).toBe('A workbook keeps at least one sheet');
  });
});

describe('revise_docx', () => {
  it('按块重写并沿用原件的标题样式（中文 Word 的样式 ID 是「1」），报告图片、页眉页脚与批注没有保留', async () => {
    const plain = await writeDocx({ blocks: [{ type: 'paragraph', text: '原文' }] });
    const styles = readZipEntry(plain, zipEntries(plain).find((e) => e.name === 'word/styles.xml') as never, 1 << 24)
      .toString('utf8')
      .replace('w:styleId="Heading1"', 'w:styleId="1"');
    const source = repacked(
      plain,
      { 'word/media/image1.png': 'png', 'word/header1.xml': '<w:hdr/>', 'word/comments.xml': '<w:comments/>' },
      { 'word/styles.xml': styles },
    );
    const { bytes, lost } = await reviseDocx(source, {
      blocks: [
        { type: 'heading', level: 1, text: '改过的标题' },
        { type: 'paragraph', text: '新的正文' },
      ],
    });
    expect(lost).toEqual([
      { kind: 'images', count: 1 },
      { kind: 'headers_footers', count: 1 },
      { kind: 'comments', count: 1 },
    ]);
    const document = readZipEntry(
      bytes,
      zipEntries(bytes).find((e) => e.name === 'word/document.xml') as never,
      1 << 24,
    );
    expect(document.toString('utf8')).toContain('<w:pStyle w:val="1"/>');
    expect((await readDocx(bytes)).text).toContain('# 改过的标题\n\n新的正文');
  });
});
