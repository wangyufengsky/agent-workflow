import { textLines } from '@aw/shared';
import { diffArrays } from 'diff';

export type VersionChange = { kind: 'added' | 'modified'; before?: string };
/** 以未变的段落为锚点，在相邻的删除和插入块内逐行对照。 */
export function changedLines(before: string, after: string): Map<number, VersionChange> {
  const changes = new Map<number, VersionChange>();
  const parts = diffArrays(textLines(before), textLines(after), { timeout: 150 });
  if (!parts) return changes;
  let line = 1;
  for (const [i, part] of parts.entries()) {
    if (part.removed) continue;
    const previous = parts[i - 1];
    if (part.added)
      for (const [offset] of part.value.entries()) {
        const old = previous?.removed ? previous.value[offset] : undefined;
        changes.set(line + offset, old === undefined ? { kind: 'added' } : { kind: 'modified', before: old });
      }
    line += part.count;
  }
  return changes;
}
