import { AcceptanceCheckKind, NodeKind, PROJECT_CHECK_PLACEHOLDER, type WorkflowDefinition } from '@aw/shared';
import { expect, it } from 'vitest';
import { workflowDefinitionFromPlan } from './from-plan.ts';

it('保留业务步骤、角色和计划检查，并穿过运行时步骤保留依赖', () => {
  const original: WorkflowDefinition = {
    allowedRoles: ['developer'],
    checkpoints: { confirm_plan: false, accept_each_node: false },
    defaultAcceptance: {
      checks: [{ kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER }],
      manual: false,
    },
  };
  const step = { title: 'Step', roleKey: 'developer', instructions: 'Do it' };
  const definition = workflowDefinitionFromPlan(
    {
      nodes: [
        { ...step, key: 'a', dependsOn: [] },
        { ...step, key: 'verify', kind: NodeKind.Verify, dependsOn: ['a'] },
        { ...step, key: 'b', roleKey: 'reviewer', dependsOn: ['verify'] },
      ],
    },
    original,
  );
  expect(definition.allowedRoles).toEqual(['developer', 'reviewer']);
  expect(definition.defaultAcceptance).toEqual(original.defaultAcceptance);
  expect(definition.template?.nodes.map(({ key, dependsOn }) => ({ key, dependsOn }))).toEqual([
    { key: 'a', dependsOn: [] },
    { key: 'b', dependsOn: ['a'] },
  ]);
});
