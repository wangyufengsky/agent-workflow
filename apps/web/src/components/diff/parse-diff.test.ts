import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, toSplitRows } from './parse-diff.ts';

// `git diff` output for one file: a changed line, an added line and the end-of-file marker.
const DIFF = [
  'diff --git a/greet.ts b/greet.ts',
  'index 1111111..2222222 100644',
  '--- a/greet.ts',
  '+++ b/greet.ts',
  '@@ -1,3 +1,4 @@ export {}',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('unified diff 解析', () => {
  it('按 hunk 头编号旧行与新行，忽略文件头与「没有换行」标记', () => {
    const { binary, hunks } = parseUnifiedDiff(DIFF);
    expect(binary).toBe(false);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'const a = 1;' },
      { kind: 'del', oldNo: 2, newNo: null, text: 'const b = 2;' },
      { kind: 'add', oldNo: null, newNo: 2, text: 'const b = 3;' },
      { kind: 'add', oldNo: null, newNo: 3, text: 'const c = 4;' },
      { kind: 'context', oldNo: 3, newNo: 4, text: 'const d = 5;' },
    ]);
  });

  it('并排视图把删除与其后的新增配对，多出的一侧留空', () => {
    const rows = toSplitRows(parseUnifiedDiff(DIFF).hunks[0]?.lines ?? []);
    expect(rows.map((r) => [r.left?.oldNo ?? null, r.right?.newNo ?? null])).toEqual([
      [1, 1],
      [2, 2],
      [null, 3],
      [3, 4],
    ]);
  });

  it('二进制文件没有 hunk', () => {
    expect(parseUnifiedDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toEqual({
      binary: true,
      hunks: [],
    });
  });
});
