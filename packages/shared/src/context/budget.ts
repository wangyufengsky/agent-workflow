import { DEFAULT_BYTES_PER_TOKEN, MAX_BYTES_PER_TOKEN, MIN_BYTES_PER_TOKEN } from './limits.ts';
import type { Messages } from './messages.ts';

export { DEFAULT_BYTES_PER_TOKEN, SOFT_BUDGET_RATIO } from './limits.ts';
export const SUMMARY_LABEL = '[AW prior work]\n';
const IMAGE_TOKEN_ESTIMATE = 2048;
const encoder = new TextEncoder();
export const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
export type Sample = { bytes: number; tokens: number };
/** 外部 MCP 定义在相邻轮次固定；相邻实测的差分消去这项未知常数。 */
export function calibrate(sample: Sample, previous: Sample | undefined, external: boolean): number | undefined {
  const size = external ? sample.bytes - (previous?.bytes ?? sample.bytes) : sample.bytes;
  const tokens = external ? sample.tokens - (previous?.tokens ?? sample.tokens) : Math.max(1, sample.tokens);
  if ((external && Math.abs(size) < 3000) || tokens === 0 || size / tokens <= 0) return undefined;
  return Math.max(MIN_BYTES_PER_TOKEN, Math.min(MAX_BYTES_PER_TOKEN, size / tokens));
}
export function historySize(messages: Messages) {
  let dialogue = 0,
    toolOutput = 0,
    summary = 0,
    media = 0;
  function fileSize(file: Extract<Messages[number]['parts'][number], { type: 'file' }>) {
    if (!file.mime.startsWith('image/')) return bytes(file);
    media += IMAGE_TOKEN_ESTIMATE;
    return bytes({ ...file, url: '' });
  }
  for (const { info, parts } of messages) {
    dialogue += bytes(info.role);
    for (const p of parts) {
      if (p.type === 'tool' && p.state.status === 'completed') {
        dialogue += bytes([p.tool, p.callID, p.state.input, p.metadata]);
        toolOutput += bytes(p.state.output);
        for (const file of p.state.attachments ?? []) dialogue += fileSize(file);
      } else if (p.type === 'text' && info.role === 'assistant' && (info.summary || p.text.startsWith(SUMMARY_LABEL)))
        summary += bytes(p);
      else dialogue += p.type === 'file' ? fileSize(p) : bytes(p);
    }
  }
  return { dialogue, toolOutput, summary, media, text: dialogue + toolOutput + summary };
}
export function historyBytes(messages: Messages) {
  const size = historySize(messages);
  return size.text + size.media * DEFAULT_BYTES_PER_TOKEN;
}
