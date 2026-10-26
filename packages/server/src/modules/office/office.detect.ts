import {
  AppError,
  AttachmentFormat,
  AttachmentLimit,
  AttachmentRejection,
  ErrorCode,
  OFFICE_UNZIPPED_BYTES_MAX,
} from '@aw/shared';
import { readZipEntry, zipEntries } from './office.zip.ts';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** OLE compound files: Word / Excel 97–2003, and Office files encrypted with an opening password. */
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** The stream an encrypted Office file keeps its key data in; directory entry names are UTF-16LE. */
const ENCRYPTION_INFO = Buffer.from('EncryptionInfo', 'utf16le');
const CONTENT_TYPES = '[Content_Types].xml';

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
 * What the bytes are, by content rather than name or MIME type (39 §4). Word and Excel files are checked to unzip
 * within `OFFICE_UNZIPPED_BYTES_MAX` before anyone inflates them; other Office-like files are rejected with a reason.
 * Everything else is `text` for the text check to decide.
 */
export function detectFormat(bytes: Buffer): AttachmentFormat {
  if (bytes.subarray(0, OLE.length).equals(OLE)) {
    if (bytes.includes(ENCRYPTION_INFO)) throw rejected(AttachmentRejection.Encrypted, 'Password-protected file');
    throw rejected(AttachmentRejection.LegacyOffice, 'Word / Excel 97-2003 file');
  }
  if (!bytes.subarray(0, ZIP.length).equals(ZIP)) return AttachmentFormat.Text;
  const entries = zipEntries(bytes);
  const unzipped = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (unzipped > OFFICE_UNZIPPED_BYTES_MAX) {
    throw new AppError(ErrorCode.AttachmentTooLarge, 'Unzipped size limit exceeded', {
      reason: AttachmentLimit.Unzipped,
      limit: OFFICE_UNZIPPED_BYTES_MAX,
    });
  }
  const contentTypes = entries.find((entry) => entry.name === CONTENT_TYPES);
  if (contentTypes === undefined) throw rejected(AttachmentRejection.Unsupported, 'Not an Office Open XML file');
  const declared = readZipEntry(bytes, contentTypes).toString('utf8');
  const main = MAIN_PARTS.find(([type]) => declared.includes(`"${type}"`));
  if (main === undefined) throw rejected(AttachmentRejection.Unsupported, 'Neither a Word document nor a workbook');
  return main[1];
}
