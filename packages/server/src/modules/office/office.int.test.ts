import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AttachmentFormat,
  AttachmentParseFailure,
  ErrorCode,
  OFFICE_CELLS_MAX,
  OFFICE_UNZIPPED_BYTES_MAX,
  OFFICE_WORKER_TIMEOUT_MS,
} from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { makeZip, minimalXlsx } from '../../../test/helpers/zip.ts';
import { createOffice, detectFormat, OFFICE_TEXT_FILE, type OfficeFormat, WORKBOOK_FILE } from './index.ts';
import { columnName, type Workbook } from './office.xlsx.ts';

const workerFile = fileURLToPath(new URL('./office.worker.ts', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../../../test/fixtures/office/${name}`, import.meta.url));

/** Parses `bytes` the way an upload does: detect, then the worker writes next to the original. */
async function parse(bytes: Buffer, options: { heapMb?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aw-office-'));
  const source = join(dir, 'original');
  await writeFile(source, bytes);
  const office = createOffice({ clock: createFakeClock(), workerFile, ...options });
  const meta = await office.parse(detectFormat(bytes) as OfficeFormat, source, dir);
  return { meta, text: await readFile(join(dir, OFFICE_TEXT_FILE), 'utf8'), dir };
}
const errorOf = (work: () => unknown) =>
  Promise.resolve()
    .then(work)
    .then(
      () => undefined,
      (err: { code: string; details?: unknown }) => ({ code: err.code, details: err.details }),
    );

describe('识别格式（看内容不看扩展名）', () => {
  it('旧版 .doc / .xls 与加了打开密码的文件被拒并说明原因', async () => {
    for (const [name, reason] of [
      ['report.doc', 'legacy_office'],
      ['sales.xls', 'legacy_office'],
      ['report.encrypted.docx', 'encrypted'],
    ] as const) {
      const bytes = await readFile(fixture(name));
      expect(await errorOf(() => detectFormat(bytes))).toEqual({
        code: ErrorCode.AttachmentInvalidType,
        details: { reason },
      });
    }
  });

  it('其他 zip 不是 Word / Excel；解压后超过上限的在解压前就被拒', async () => {
    const archive = makeZip([{ name: 'notes.txt', content: 'hello' }]);
    expect(await errorOf(() => detectFormat(archive))).toMatchObject({ details: { reason: 'unsupported' } });
    const bomb = makeZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: 'xl/worksheets/sheet1.xml', content: 'x', declaredSize: OFFICE_UNZIPPED_BYTES_MAX },
    ]);
    expect(await errorOf(() => detectFormat(bomb))).toEqual({
      code: ErrorCode.AttachmentTooLarge,
      details: { reason: 'unzipped', limit: OFFICE_UNZIPPED_BYTES_MAX },
    });
    expect(detectFormat(Buffer.from('a,b\n1,2\n'))).toBe(AttachmentFormat.Text);
  });
});

describe('在 worker 线程里读出文字', () => {
  it('LibreOffice 保存的 Word：标题、列表、表格与图片占位', async () => {
    const { meta, text } = await parse(await readFile(fixture('report.libreoffice.docx')));
    expect(meta).toEqual({ format: 'docx', chars: text.length - 1, headings: 3, tables: 1, images: 1 });
    expect(text).toContain('# 订单导出需求');
    expect(text).toContain('| order_id | string | 订单号 |');
    expect(text).toContain('[图片 1：导出按钮位置]');
  });

  it('macOS 文本编辑保存的 Word 没有标题样式，按段落读出', async () => {
    const { meta, text } = await parse(await readFile(fixture('report.textutil.docx')));
    expect(meta).toMatchObject({ headings: 0, tables: 0 });
    expect(text).toContain('**订单导出需求**');
  });

  it('LibreOffice 保存的 Excel：各工作表的文字与单元格，公式取文件里缓存的结果', async () => {
    const { meta, text, dir } = await parse(await readFile(fixture('sales.libreoffice.xlsx')));
    expect(meta).toMatchObject({
      format: 'xlsx',
      formulas: 9,
      sheets: [
        { name: '明细', range: 'A1:F6', rows: 6, columns: 6, hidden: false },
        { name: '汇总', range: 'A1:B7' },
        { name: '隐藏', hidden: true },
      ],
    });
    expect(text).toContain('| 6 | 合计 | 2791.5 |');
    const workbook: Workbook = JSON.parse(await readFile(join(dir, WORKBOOK_FILE), 'utf8'));
    expect(workbook.sheets[1]?.rows.find((row) => row.r === 6)?.cells[1]).toEqual({ c: 2, v: 2791.5, f: 'SUM(B3:B5)' });
  });

  it('损坏的文件为 ATTACHMENT_PARSE_FAILED', async () => {
    const broken = makeZip([
      {
        name: '[Content_Types].xml',
        content:
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      { name: 'word/document.xml', content: '<w:document' },
    ]);
    expect(await errorOf(() => parse(broken))).toEqual({
      code: ErrorCode.AttachmentParseFailed,
      details: { reason: AttachmentParseFailure.Corrupt },
    });
  });

  it('非空单元格超过上限时拒绝，不只读一部分', async () => {
    const perRow = 1000;
    const rows = Math.ceil((OFFICE_CELLS_MAX + 1) / perRow);
    const cells = (r: number) =>
      Array.from({ length: perRow }, (_, c) => `<c r="${columnName(c + 1)}${r}"><v>1</v></c>`).join('');
    const row = (r: number) => `<row r="${r}">${cells(r)}</row>`;
    const bytes = minimalXlsx(Array.from({ length: rows }, (_, i) => row(i + 1)).join(''));
    expect(await errorOf(() => parse(bytes))).toEqual({
      code: ErrorCode.AttachmentTooLarge,
      details: { reason: 'cells', limit: OFFICE_CELLS_MAX },
    });
  });

  it('超过时限时结束 worker，为 timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-office-'));
    const clock = createFakeClock();
    const office = createOffice({ clock, workerFile });
    const parsing = office.parse(AttachmentFormat.Docx, fixture('report.libreoffice.docx'), dir);
    clock.advance(OFFICE_WORKER_TIMEOUT_MS);
    expect(await errorOf(() => parsing)).toEqual({
      code: ErrorCode.AttachmentParseFailed,
      details: { reason: AttachmentParseFailure.Timeout },
    });
  });

  it('超过内存上限时为 out_of_memory', async () => {
    // Much smaller and V8 aborts the whole process instead of the worker.
    expect(await errorOf(() => parse(minimalXlsx('<row r="1"><c r="A1"><v>1</v></c></row>'), { heapMb: 8 }))).toEqual({
      code: ErrorCode.AttachmentParseFailed,
      details: { reason: AttachmentParseFailure.OutOfMemory },
    });
  });
});
