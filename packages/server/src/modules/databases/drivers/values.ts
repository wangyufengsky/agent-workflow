/** Binary values are shown as hex, cut to this many bytes (12 §6.11). */
const BINARY_PREVIEW_BYTES = 64;

/** A query value as JSON can carry it: binary as `0x…` hex, everything else as the driver gave it. */
export function toJsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    const hex = value.subarray(0, BINARY_PREVIEW_BYTES).toString('hex');
    return `0x${hex}${value.length > BINARY_PREVIEW_BYTES ? '…' : ''}`;
  }
  return value;
}
