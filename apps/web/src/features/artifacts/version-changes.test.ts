import { expect, it } from 'vitest';
import { changedLines } from './version-changes.ts';

it('插入段落后按内容对齐，修改保留旧值，后续相同段落不标记', () => {
  expect([...changedLines('标题\n原内容\n结语', '开场\n标题\n新内容\n结语')]).toEqual([
    [1, { kind: '新增' }],
    [3, { kind: '修改', before: '原内容' }],
  ]);
});
