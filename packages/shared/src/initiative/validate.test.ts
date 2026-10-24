import { describe, expect, it } from 'vitest';
import { type InitiativeDraft, initiativeDraftSchema } from '../contracts/api/initiatives.ts';
import { validateInitiativeDraft } from './validate.ts';

const draft = (input: unknown): InitiativeDraft => initiativeDraftSchema.parse(input);
const known = new Set(['design_proposal', 'feature', 'code_review']);
const rules = { workflowExists: (key: string) => known.has(key) };
const codes = (d: InitiativeDraft, template = false) =>
  validateInitiativeDraft(d, { ...rules, template }).map((p) => [p.code, p.itemKey ?? null]);

const item = (key: string, phase: number, dependsOn: string[] = [], workflow = 'feature') => ({
  key,
  title: key,
  phase,
  workflow,
  requirement: `做 ${key}`,
  dependsOn,
});

describe('阶段与工作包的校验（34 §8.3）', () => {
  it('依赖只能指向同一阶段或更早阶段，且不能成环', () => {
    const d = draft({
      phases: [{ title: '一' }, { title: '二' }],
      items: [item('a', 1, ['b']), item('b', 2), item('c', 2, ['d']), item('d', 2, ['c'])],
    });
    expect(codes(d)).toEqual([
      ['DEPENDENCY_PHASE', 'a'],
      ['CYCLE', 'c'],
    ]);
  });

  it('空阶段、不存在的阶段、依赖与流程、重复的 key 都报出来', () => {
    const d = draft({
      phases: [{ title: '一' }, { title: '二' }],
      items: [item('a', 1, ['x']), item('a', 3, [], 'nope')],
    });
    expect(codes(d)).toEqual([
      ['DUPLICATE_KEY', 'a'],
      ['UNKNOWN_DEPENDENCY', 'a'],
      ['PHASE_OUT_OF_RANGE', 'a'],
      ['UNKNOWN_WORKFLOW', 'a'],
      ['EMPTY_PHASE', null],
    ]);
  });

  it('组合模板至少一个工作包的需求含 {{requirement}}', () => {
    const plain = draft({ phases: [{ title: '一' }], items: [item('a', 1)] });
    expect(codes(plain, true)).toEqual([['TEMPLATE_REQUIREMENT_MISSING', null]]);
    const withPlaceholder = draft({
      phases: [{ title: '一' }],
      items: [{ ...item('a', 1), requirement: '{{requirement}}' }],
    });
    expect(codes(withPlaceholder, true)).toEqual([]);
  });
});
