import { describe, expect, it } from 'vitest';
import { requirementChanges } from './requirements-impact.tsx';

describe('确认卡中的验收条件变化', () => {
  it('按清单项识别修改、删除和新增，保留新旧完整条件', () => {
    const old = [
      { id: 'a', title: '构建', expected: '成功', required: true, verification: { kind: 'command', command: 'false' } },
      { id: 'b', title: '界面', expected: '可用', required: false, verification: { kind: 'manual' } },
    ] as const;
    const updated = [
      { id: 'a', title: '构建', expected: '通过', required: true, verification: { kind: 'command', command: 'true' } },
      { title: '文档', expected: '完整', verification: { kind: 'ai_review' } },
    ] as const;
    expect(requirementChanges(old, updated)).toEqual([
      { before: old[1], after: undefined },
      { before: old[0], after: updated[0] },
      { before: undefined, after: updated[1] },
    ]);
    expect(requirementChanges(old, old)).toEqual([]);
  });
});
