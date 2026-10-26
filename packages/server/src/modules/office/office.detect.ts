import { AppError, AttachmentFormat, AttachmentRejection, ErrorCode } from '@aw/shared';
import { readZipEntry, zipEntries } from './office.zip.ts';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** OLE compound files: Word / Excel 97–2003, and Office files encrypted with an opening password. */
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** The stream an encrypted Office file keeps its key data in; directory entry names are UTF-16LE. */
const ENCRYPTION_INFO = Buffer.from('EncryptionInfo', 'utf16le');
const CONTENT_TYPES = '[Content_Types].xml';
/** `[Content_Types].xml` lists a few dozen parts; anything near this is not an Office file. */
const CONTENT_TYPES_MAX_BYTES = 1024 * 1024;

/** The main part's content type tells a Word document from an Excel workbook, macros or not (39 §4). */
const MAIN_PARTS: ReadonlyArray<readonly [string, AttachmentFormat]> = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', AttachmentFormat.Docx],
  ['application/vnd.ms-word.document.macroEnabled.main+xml', AttachmentFormat.Docx],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', AttachmentFormat.Xlsx],
  ['application/vnd.ms-excel.sheet.macroEnabled.main+xml', AttachmentFormat.Xlsx],
];

const rejected = (reason: AttachmentRejection, message: string) =>
  new AppError(ErrorCode.AttachmentInvalidType, message, { reason });

/**
 * What the bytes are, by content rather than name or MIME type (39 §4); only the small `[Content_Types].xml` is
 * inflated here, the worker checks the rest unzips within its limit before parsing. Other Office-like files are
 * rejected with a reason. Everything else is `text` for the text check to decide.
 */
export function detectFormat(bytes: Buffer): AttachmentFormat {
  if (bytes.subarray(0, OLE.length).equals(OLE)) {
    if (bytes.includes(ENCRYPTION_INFO)) throw rejected(AttachmentRejection.Encrypted, 'Password-protected file');
    throw rejected(AttachmentRejection.LegacyOffice, 'Word / Excel 97-2003 file');
  }
  if (!bytes.subarray(0, ZIP.length).equals(ZIP)) return AttachmentFormat.Text;
  const contentTypes = zipEntries(bytes).find((entry) => entry.name === CONTENT_TYPES);
  if (contentTypes === undefined) throw rejected(AttachmentRejection.Unsupported, 'Not an Office Open XML file');
  const declared = readZipEntry(bytes, contentTypes, CONTENT_TYPES_MAX_BYTES).toString('utf8');
  const main = MAIN_PARTS.find(([type]) => declared.includes(`"${type}"`));
  if (main === undefined) throw rejected(AttachmentRejection.Unsupported, 'Neither a Word document nor a workbook');
  return main[1];
}
