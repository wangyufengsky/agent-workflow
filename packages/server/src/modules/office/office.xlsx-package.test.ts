import { AttachmentLimit, ErrorCode } from '@aw/shared';
import { expect, it } from 'vitest';
import { makeZip } from '../../../test/helpers/zip.ts';
import { compatibleXlsxBytes } from './office.xlsx-package.ts';
import { assertUnzipsWithin, readZipEntry, zipEntries } from './office.zip.ts';

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const workbook = (text: string) =>
  `<x:workbook xmlns:x="${ns}"><x:sheets/><x:definedName>${text}</x:definedName></x:workbook>`;

it('兼容转换的总解压预算以实测字节为准，包含没有转换的部件', async () => {
  const xml = workbook('');
  const other = Buffer.alloc(100, 32);
  const bytes = makeZip([
    { name: 'xl/workbook.xml', content: xml },
    { name: 'docProps/core.xml', content: other, declaredSize: 1 },
  ]);
  const entries = zipEntries(bytes);
  const limit = Buffer.byteLength(xml) + other.length + 1;
  expect(await assertUnzipsWithin(bytes, entries, limit)).toBe(limit - 1);
  await expect(compatibleXlsxBytes(bytes, entries, undefined, limit)).rejects.toMatchObject({
    code: ErrorCode.AttachmentTooLarge,
    details: { reason: AttachmentLimit.Unzipped, limit },
  });
});

it('合法的普通大于号无需转义，转换保留单元格文本和简写标签', async () => {
  const text = '>'.repeat(4096);
  const xml = workbook(`${text}]]&gt;`);
  const bytes = makeZip([{ name: 'xl/workbook.xml', content: xml }]);
  const limit = Buffer.byteLength(xml) + 100;
  const normalized = await compatibleXlsxBytes(bytes, zipEntries(bytes), undefined, limit);
  const sheet = zipEntries(normalized).find(({ name }) => name === 'xl/workbook.xml');
  if (sheet === undefined) throw new Error('Expected workbook part');
  const result = readZipEntry(normalized, sheet, limit).toString('utf8');
  expect(result).toContain('<sheets/>');
  expect(result).toContain(`<definedName>${text}]]&gt;</definedName>`);
});
