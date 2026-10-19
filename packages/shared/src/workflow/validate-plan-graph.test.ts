import { describe, expect, it } from 'vitest';
import { NODE_INSTRUCTIONS_MAX_CHARS, PLAN_MAX_NODES } from '../constants/limits.ts';
import type { PlanGraph, PlanNodeSpec } from './plan-graph.ts';
import { type PlanRules, validatePlanGraph } from './validate-plan-graph.ts';

const node = (key: string, dependsOn: string[] = [], extra: Partial<PlanNodeSpec> = {}): PlanNodeSpec => ({
  key,
  title: key,
  roleKey: 'developer',
  instructions: `do ${key}`,
  dependsOn,
  ...extra,
});
const graph = (...nodes: PlanNodeSpec[]): PlanGraph => ({ nodes });
const rules = (extra: Partial<PlanRules> = {}): PlanRules => ({
  allowedRoles: ['developer', 'tester'],
  requiredSteps: [],
  ...extra,
});
const codes = (g: PlanGraph, r = rules()) => validatePlanGraph(g, r).map((p) => p.code);

describe('validatePlanGraph', () => {
  it('合法计划没有问题', () => {
    expect(validatePlanGraph(graph(node('a'), node('b', ['a']), node('c', ['a', 'b'])), rules())).toEqual([]);
  });

  it('拒绝空计划并返回 EMPTY', () => {
    expect(codes(graph())).toEqual(['EMPTY']);
  });

  it('节点数超过上限返回 TOO_MANY_NODES', () => {
    const nodes = Array.from({ length: PLAN_MAX_NODES + 1 }, (_, i) => node(`n${i}`));
    expect(codes(graph(...nodes))).toEqual(['TOO_MANY_NODES']);
  });

  it('重复的 key 返回 DUPLICATE_KEY', () => {
    expect(validatePlanGraph(graph(node('a'), node('a')), rules())).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_KEY', nodeKey: 'a' }),
    ]);
  });

  it('依赖不存在的节点返回 UNKNOWN_DEPENDENCY', () => {
    expect(validatePlanGraph(graph(node('a', ['ghost'])), rules())).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_DEPENDENCY', nodeKey: 'a', details: { dependency: 'ghost' } }),
    ]);
  });

  it('拒绝包含环的计划并返回 CYCLE 与环路', () => {
    const problems = validatePlanGraph(graph(node('a', ['c']), node('b', ['a']), node('c', ['b'])), rules());
    expect(problems).toEqual([expect.objectContaining({ code: 'CYCLE', details: { cycle: ['a', 'c', 'b', 'a'] } })]);
  });

  it('自依赖也是环', () => {
    expect(codes(graph(node('a', ['a'])))).toEqual(['CYCLE']);
  });

  it('角色不在允许列表返回 UNKNOWN_ROLE 与允许列表', () => {
    expect(validatePlanGraph(graph(node('a', [], { roleKey: 'chef' })), rules())).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_ROLE',
        nodeKey: 'a',
        details: { allowedRoles: ['developer', 'tester'] },
      }),
    ]);
  });

  it('缺少必经步骤返回 MISSING_REQUIRED_STEP', () => {
    const r = rules({ requiredSteps: [{ key: 'verify', position: 'last' }] });
    expect(validatePlanGraph(graph(node('a')), r)).toEqual([
      expect.objectContaining({ code: 'MISSING_REQUIRED_STEP', details: { requiredStep: 'verify' } }),
    ]);
  });

  it('first 必经步骤须被所有节点传递依赖，否则 REQUIRED_STEP_ORDER', () => {
    const r = rules({ requiredSteps: [{ key: 'analyze', position: 'first' }] });
    expect(codes(graph(node('analyze'), node('a', ['analyze']), node('b', ['a'])), r)).toEqual([]);
    expect(validatePlanGraph(graph(node('analyze'), node('a', ['analyze']), node('b')), r)).toEqual([
      expect.objectContaining({
        code: 'REQUIRED_STEP_ORDER',
        nodeKey: 'analyze',
        details: { position: 'first', nodes: ['b'] },
      }),
    ]);
  });

  it('last 必经步骤须传递依赖所有节点，否则 REQUIRED_STEP_ORDER', () => {
    const r = rules({ requiredSteps: [{ key: 'verify', position: 'last' }] });
    expect(codes(graph(node('a'), node('b', ['a']), node('verify', ['b'])), r)).toEqual([]);
    expect(validatePlanGraph(graph(node('a'), node('b'), node('verify', ['b'])), r)).toEqual([
      expect.objectContaining({
        code: 'REQUIRED_STEP_ORDER',
        nodeKey: 'verify',
        details: { position: 'last', nodes: ['a'] },
      }),
    ]);
  });

  it('没有 position 的必经步骤只校验存在', () => {
    const r = rules({ requiredSteps: [{ key: 'docs' }] });
    expect(codes(graph(node('a'), node('docs')), r)).toEqual([]);
  });

  it('指令超长返回 INSTRUCTIONS_TOO_LONG', () => {
    const long = node('a', [], { instructions: 'x'.repeat(NODE_INSTRUCTIONS_MAX_CHARS + 1) });
    expect(codes(graph(long))).toEqual(['INSTRUCTIONS_TOO_LONG']);
  });

  it('一次返回全部问题，便于模型一轮修正', () => {
    const g = graph(node('a', ['ghost'], { roleKey: 'chef' }), node('a'));
    expect(codes(g).sort()).toEqual(['DUPLICATE_KEY', 'UNKNOWN_DEPENDENCY', 'UNKNOWN_ROLE']);
  });
});
