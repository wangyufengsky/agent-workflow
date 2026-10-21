import { describe, expect, it } from 'vitest';
import { parseTargets, toggleTarget } from './targets.ts';

describe('批量任务的目标（20 §2）', () => {
  it('按行解析：去掉首尾空白，忽略空行', () => {
    expect(parseTargets('  src/a/ \n\n\tsrc/b/\r\n   \nUserService')).toEqual(['src/a/', 'src/b/', 'UserService']);
  });

  it('勾选追加到末尾，取消勾选保留其余顺序', () => {
    expect(toggleTarget(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleTarget(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});
