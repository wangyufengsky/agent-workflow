import { inflateRawSync } from 'node:zlib';
import { AppError, AttachmentParseFailure, ErrorCode } from '@aw/shared';

/** One file in a zip, as its central directory describes it. */
export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_BYTES = 22;
const STORED = 0;
const DEFLATED = 8;
/** Zip64 puts this in a field whose value lives elsewhere; Office files of our sizes never need it. */
const ZIP64 = 0xffffffff;

export const corrupt = (message: string) =>
  new AppError(ErrorCode.AttachmentParseFailed, message, { reason: AttachmentParseFailure.Corrupt });

/**
 * The entries of a zip from its central directory, without unpacking anything (39 §5.1: the unzipped size is known
 * before any part is inflated).
 */
export function zipEntries(bytes: Buffer): ZipEntry[] {
  // The end record is the last thing in the file, followed by a comment of at most 64 KiB.
  const lowest = Math.max(0, bytes.length - END_RECORD_BYTES - 0xffff);
  let end = -1;
  for (let i = bytes.length - END_RECORD_BYTES; i >= lowest; i--) {
    if (bytes.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw corrupt('No zip central directory');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  if (at === ZIP64 || at >= end) throw corrupt('Unreadable zip central directory');
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== CENTRAL_FILE_HEADER) throw corrupt('Truncated zip directory');
    const nameLength = bytes.readUInt16LE(at + 28);
    const entry = {
      method: bytes.readUInt16LE(at + 10),
      compressedSize: bytes.readUInt32LE(at + 20),
      size: bytes.readUInt32LE(at + 24),
      localOffset: bytes.readUInt32LE(at + 42),
      name: bytes.toString('utf8', at + 46, at + 46 + nameLength),
    };
    if (entry.size === ZIP64 || entry.compressedSize === ZIP64 || entry.localOffset === ZIP64) {
      throw corrupt('Zip64 entries are not supported');
    }
    entries.push(entry);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return entries;
}

/** One entry's content, inflated to at most the size the directory declared. */
export function readZipEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL_FILE_HEADER) {
    throw corrupt(`Bad local header for ${entry.name}`);
  }
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === STORED) return data;
  if (entry.method !== DEFLATED) throw corrupt(`Unsupported compression for ${entry.name}`);
  try {
    // Capped, so a lying entry cannot inflate past the checked total.
    return inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
  } catch (err) {
    throw corrupt(`Cannot inflate ${entry.name}: ${String(err)}`);
  }
}
