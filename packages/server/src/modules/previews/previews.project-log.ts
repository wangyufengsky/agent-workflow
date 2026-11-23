import { stripVTControlCharacters } from 'node:util';
import { createPreviewLog } from './previews.process.ts';

const MAX_LINE = 16_384;
const SECRET_KEY = /password|passwd|secret|cookie|authorization|api.?key|access.?key|private.?key|credential|token/i;

export function createProjectLog(env: NodeJS.ProcessEnv) {
  const values = [
    ...new Set(
      Object.entries(env)
        .filter(([key, value]) => SECRET_KEY.test(key) && value !== undefined && value.length >= 4)
        .map(([, value]) => value ?? ''),
    ),
  ].sort((a, b) => b.length - a.length);
  const output = createPreviewLog(null);
  let line = '';
  let overflow = false;
  const flush = () => {
    let text = stripVTControlCharacters(line)
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
      .replace(/\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(
        /((?:password|passwd|token|authorization|cookie|secret|api.?key|access.?key|credential)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&"']+)/gi,
        '$1[redacted]',
      );
    for (const secret of values) text = text.replaceAll(secret, '[redacted]');
    output.append(overflow ? '[oversized module output omitted]\n' : `${text}\n`);
    line = '';
    overflow = false;
  };
  return {
    ...output,
    append(text: string) {
      const parts = text.split('\n');
      for (const [index, part] of parts.entries()) {
        if (!overflow) {
          overflow = line.length + part.length > MAX_LINE;
          if (overflow) line = '';
          else line += part;
        }
        if (index < parts.length - 1) flush();
      }
    },
    flush() {
      if (line || overflow) flush();
    },
  };
}
