import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from './plan-graph.ts';
import { type RoleRef, validateWorkflowDefinition } from './validate-workflow.ts';

const roles: RoleRef[] = [
  { key: 'planner', baseAgent: 'planner' },
  { key: 'developer', baseAgent: 'executor' },
];
const base: WorkflowDefinition = {
  allowedRoles: ['developer'],
  checkpoints: { confirm_plan: false, accept_each_node: false },
  defaultAcceptance: { checks: [], manual: false },
};
const step = { key: 'a', title: 'A', roleKey: 'developer', instructions: 'do', dependsOn: [] };
const codes = (planning: 'fixed' | 'ai', definition: WorkflowDefinition) =>
  validateWorkflowDefinition({ planning, definition }, roles).map((p) => [p.code, p.field]);

describe('validateWorkflowDefinition', () => {
  it('合法的固定流程与 AI 规划流程没有问题', () => {
    expect(codes('fixed', { ...base, template: { nodes: [step] } })).toEqual([]);
    expect(codes('ai', { ...base, plannerRole: 'planner', requiredSteps: [step] })).toEqual([]);
  });

  it('没有允许的角色返回 NO_ALLOWED_ROLES，角色不存在返回 ROLE_NOT_FOUND', () => {
    expect(codes('ai', { ...base, allowedRoles: [], plannerRole: 'planner' })).toEqual([
      ['NO_ALLOWED_ROLES', 'allowedRoles'],
    ]);
    expect(codes('ai', { ...base, allowedRoles: ['chef'], plannerRole: 'ghost' })).toEqual([
      ['ROLE_NOT_FOUND', 'allowedRoles'],
      ['ROLE_NOT_FOUND', 'plannerRole'],
    ]);
  });

  it('固定流程缺模板返回 MISSING_TEMPLATE，模板问题沿用计划校验子码', () => {
    expect(codes('fixed', base)).toEqual([['MISSING_TEMPLATE', 'template']]);
    expect(codes('fixed', { ...base, template: { nodes: [{ ...step, dependsOn: ['b'] }] } })).toEqual([
      ['UNKNOWN_DEPENDENCY', 'template'],
    ]);
  });

  it('AI 规划流程缺规划者返回 MISSING_PLANNER，规划者不是 planner 返回 PLANNER_ROLE_INVALID', () => {
    expect(codes('ai', base)).toEqual([['MISSING_PLANNER', 'plannerRole']]);
    expect(codes('ai', { ...base, plannerRole: 'developer' })).toEqual([['PLANNER_ROLE_INVALID', 'plannerRole']]);
  });

  it('必经步骤重复、角色不被允许、指令超长分别报告', () => {
    const requiredSteps = [step, { ...step, roleKey: 'planner', instructions: 'x'.repeat(9000) }];
    expect(codes('ai', { ...base, plannerRole: 'planner', requiredSteps })).toEqual([
      ['DUPLICATE_KEY', 'requiredSteps'],
      ['UNKNOWN_ROLE', 'requiredSteps'],
      ['INSTRUCTIONS_TOO_LONG', 'requiredSteps'],
    ]);
  });

  it('最先或最后的必经步骤多于一个时返回 REQUIRED_STEP_ORDER：没有计划能同时满足', () => {
    const requiredSteps = [
      { ...step, key: 'a', position: 'first' as const },
      { ...step, key: 'b', position: 'first' as const },
      { ...step, key: 'c', position: 'last' as const },
      { ...step, key: 'd', position: 'last' as const },
    ];
    expect(codes('ai', { ...base, plannerRole: 'planner', requiredSteps })).toEqual([
      ['REQUIRED_STEP_ORDER', 'requiredSteps'],
      ['REQUIRED_STEP_ORDER', 'requiredSteps'],
    ]);
  });
});
