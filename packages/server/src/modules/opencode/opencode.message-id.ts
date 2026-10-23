import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let previousTimestamp = 0;
let sequence = 0;

/** 沿用 opencode 1.19 的 msg_ + 48 位毫秒序号 + 14 位 base62 格式，保持历史排序兼容。 */
export function createMessageId(timestamp: number): string {
  sequence = previousTimestamp === timestamp ? sequence + 1 : 1;
  previousTimestamp = timestamp;
  const ordered = (BigInt(timestamp) * 4096n + BigInt(sequence)) & ((1n << 48n) - 1n);
  const random = Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `msg_${ordered.toString(16).padStart(12, '0')}${random}`;
}
