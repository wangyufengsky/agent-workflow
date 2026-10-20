import { loadBuiltinRoles, loadBuiltinWorkflows } from '@aw/builtin';
import { ErrorCode, getWorkflowOp, listRolesOp, listWorkflowsOp, updateRoleOp, updateWorkflowOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { loadConfig } from '../../core/config.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const promptsDir = loadConfig({ AW_API_TOKEN: 'x'.repeat(32), AW_DATA_DIR: '/tmp' }).promptsDir;

describe('内置流程与角色', () => {
  it('首次启动写入 4 个角色与 5 个流程，按内置顺序列出', async () => {
    const roles = (await t.call(listRolesOp, {})).body.items;
    expect(roles.map((r) => [r.key, r.kind, r.baseAgent])).toEqual([
      ['planner', 'builtin', 'planner'],
      ['developer', 'builtin', 'executor'],
      ['tester', 'builtin', 'executor'],
      ['reviewer', 'builtin', 'reviewer'],
    ]);
    const workflows = (await t.call(listWorkflowsOp, {})).body.items;
    expect(workflows.map((w) => [w.key, w.version, w.planning, w.deliverable])).toEqual([
      ['feature', 1, 'ai', 'code_changes'],
      ['bugfix', 1, 'fixed', 'code_changes'],
      ['unit_tests', 1, 'fixed', 'code_changes'],
      ['code_review', 1, 'fixed', 'report'],
      ['refactor', 1, 'ai', 'code_changes'],
    ]);
    const feature = (await t.call(getWorkflowOp, { id: workflows[0]?.id ?? '' })).body;
    expect(feature.definition.plannerGuidance).toContain('final_verify');
  });

  it('再次同步相同定义不产生新版本；定义变化产生新版本并保留旧版本', async () => {
    const { workflows } = t.app.services;
    const seeds = loadBuiltinWorkflows(promptsDir);
    workflows.syncBuiltin(seeds);
    const before = workflows.list().find((w) => w.key === 'bugfix');
    expect(before?.version).toBe(1);

    workflows.syncBuiltin(seeds.map((s) => (s.key === 'bugfix' ? { ...s, description: '新的说明' } : s)));
    const after = workflows.list().find((w) => w.key === 'bugfix');
    expect(after).toMatchObject({ version: 2, description: '新的说明' });
    // Tasks keep referring to the version they started with.
    expect(workflows.get(before?.id ?? '')).toMatchObject({ version: 1, description: before?.description });
    expect(workflows.list()).toHaveLength(5);
  });

  it('内置角色的提示词或基础 agent 变化时就地更新', async () => {
    const { roles } = t.app.services;
    roles.syncBuiltin(
      loadBuiltinRoles(promptsDir).map((r) => (r.key === 'tester' ? { ...r, prompt: 'p2', baseAgent: 'reviewer' } : r)),
    );
    expect(roles.getByKey('tester')).toMatchObject({ prompt: 'p2', baseAgent: 'reviewer' });
  });

  it('内置流程与角色只读', async () => {
    const [workflow] = (await t.call(listWorkflowsOp, {})).body.items;
    const res = await t.call(updateWorkflowOp, { id: workflow?.id ?? '', name: '改名' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.WorkflowReadonly } });

    const [role] = (await t.call(listRolesOp, {})).body.items;
    const roleRes = await t.call(updateRoleOp, { id: role?.id ?? '', prompt: 'x' });
    expect(roleRes.status).toBe(409);
    expect(roleRes.body).toMatchObject({ error: { code: ErrorCode.RoleReadonly } });
  });
});
