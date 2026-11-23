import { OFFICE_UNZIPPED_BYTES_MAX } from '@aw/shared';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { assertUnzippedSize, assertUnzipsWithin, corrupt, readZipEntry, type ZipEntry } from './office.zip.ts';

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const CELL_PART = /^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+|tables\/table\d+)\.xml$/;
const PREFIX_DECLARATION =
  /\bxmlns:[\w.-]+\s*=\s*["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/;

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll(']]>', ']]&gt;');
const escapeAttribute = (value: string) =>
  escapeText(value)
    .replaceAll('"', '&quot;')
    .replaceAll('\t', '&#9;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;');

/** ExcelJS 比较工作表标签的字面名称。标准允许 SpreadsheetML 元素使用命名空间前缀。 */
function normalizeSpreadsheetXml(xml: string, room: number, limit: number): { xml: string; bytes: number } | undefined {
  const parser = new SaxesParser({ xmlns: true });
  const chunks: string[] = [];
  const defaults: string[] = [];
  let changed = false;
  let bytes = 0;
  const append = (...items: string[]) => {
    for (const item of items) bytes += Buffer.byteLength(item);
    assertUnzippedSize(limit - room + bytes, limit);
    chunks.push(...items);
  };
  parser.on('doctype', () => {
    throw corrupt('Unexpected doctype in SpreadsheetML');
  });
  parser.on('opentag', (tag) => {
    const unprefixed = tag.uri === SPREADSHEET_NS || tag.prefix === '';
    const name = unprefixed ? tag.local : tag.name;
    if (tag.uri === SPREADSHEET_NS && tag.prefix !== '') changed = true;
    const inherited = defaults.at(-1) ?? '';
    const declared = tag.attributes.xmlns?.value;
    const namespace = unprefixed ? tag.uri : (declared ?? inherited);
    append('<', name);
    for (const { name, value } of Object.values(tag.attributes)) {
      if (name !== 'xmlns') append(' ', name, '="', escapeAttribute(value), '"');
    }
    if (namespace !== inherited) append(' xmlns="', escapeAttribute(namespace), '"');
    defaults.push(namespace);
    append(tag.isSelfClosing ? '/>' : '>');
  });
  parser.on('closetag', (tag) => {
    defaults.pop();
    if (!tag.isSelfClosing) append('</', tag.uri === SPREADSHEET_NS ? tag.local : tag.name, '>');
  });
  parser.on('text', (text) => append(escapeText(text).replaceAll('\r', '&#13;')));
  parser.on('cdata', (text) => append('<![CDATA[', text, ']]>'));
  parser.on('comment', (text) => append('<!--', text, '-->'));
  parser.on('processinginstruction', ({ target, body }) => append('<?', target, ' ', body, '?>'));
  parser.write(xml).close();
  return changed ? { xml: chunks.join(''), bytes } : undefined;
}

/** 只在内存中替换读取器不认识的标签，保留附件原件和 OPC 关系。调用方先核对解压上限。 */
export async function compatibleXlsxBytes(
  bytes: Buffer,
  entries: readonly ZipEntry[],
  unzippedBytes?: number,
  limit = OFFICE_UNZIPPED_BYTES_MAX,
): Promise<Buffer> {
  const replacements = new Map<string, string>();
  for (const entry of entries) {
    if (!CELL_PART.test(entry.name)) continue;
    const original = readZipEntry(bytes, entry, limit);
    const xml = original.toString('utf8');
    if (!PREFIX_DECLARATION.test(xml)) continue;
    unzippedBytes ??= await assertUnzipsWithin(bytes, entries, limit);
    const normalized = normalizeSpreadsheetXml(xml, limit - unzippedBytes + original.length, limit);
    if (normalized !== undefined) {
      replacements.set(entry.name, normalized.xml);
      unzippedBytes += normalized.bytes - original.length;
    }
  }
  if (replacements.size === 0) return bytes;
  const packageZip = await JSZip.loadAsync(bytes);
  for (const [name, xml] of replacements) packageZip.file(name, xml);
  return packageZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true });
}
