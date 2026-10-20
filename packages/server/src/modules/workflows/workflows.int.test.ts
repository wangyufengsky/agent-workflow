import { loadBuiltinRoles, loadBuiltinWorkflows } from '@aw/builtin';
import {
  createRoleOp,
  createWorkflowOp,
  deleteRoleOp,
  deleteWorkflowOp,
  ErrorCode,
  getWorkflowOp,
  listRolesOp,
  listWorkflowsOp,
  listWorkflowVersionsOp,
  updateRoleOp,
  updateWorkflowOp,
  validateWorkflowOp,
  type WorkflowDTO,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
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

  it('内置流程全部通过流程定义校验', () => {
    const { workflows } = t.app.services;
    for (const summary of workflows.list()) {
      const { planning, definition } = workflows.get(summary.id);
      expect([summary.key, workflows.validate({ planning, definition }).problems]).toEqual([summary.key, []]);
    }
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

async function builtin(key: string): Promise<WorkflowDTO> {
  const summary = (await t.call(listWorkflowsOp, {})).body.items.find((w) => w.key === key);
  return (await t.call(getWorkflowOp, { id: summary?.id ?? '' })).body;
}

async function roleId(key: string): Promise<string> {
  return (await t.call(listRolesOp, {})).body.items.find((r) => r.key === key)?.id ?? '';
}

describe('自定义流程（M5-05）', () => {
  it('复制内置流程得到自定义流程；修改产生新版本，已开始的任务继续用旧版本', async () => {
    const bugfix = await builtin('bugfix');
    const copy = await t.call(createWorkflowOp, { copyFrom: bugfix.id, key: 'my_bugfix', name: '我的修 Bug' });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ key: 'my_bugfix', kind: 'custom', version: 1, planning: 'fixed' });
    expect(copy.body.definition).toEqual(bugfix.definition);
    expect(
      (await t.call(createWorkflowOp, { copyFrom: bugfix.id, key: 'my_bugfix', name: 'again' })).body,
    ).toMatchObject({ error: { code: ErrorCode.WorkflowAlreadyExists } });

    const { project } = await addProject(t);
    const draft = await createTask(t, { projectId: project.id, workflow: 'my_bugfix', start: false });
    const definition = { ...copy.body.definition, checkpoints: { confirm_plan: true, accept_each_node: false } };
    const v2 = await t.call(updateWorkflowOp, { id: copy.body.id, definition });
    expect(v2.body).toMatchObject({
      key: 'my_bugfix',
      version: 2,
      definition: { checkpoints: { confirm_plan: true } },
    });
    expect(draft.workflow).toMatchObject({ id: copy.body.id, version: 1 });
    expect((await t.call(listWorkflowVersionsOp, { key: 'my_bugfix' })).body.items.map((w) => w.version)).toEqual([
      2, 1,
    ]);
    expect((await t.call(listWorkflowsOp, {})).body.items.map((w) => w.key)).toContain('my_bugfix');
  });

  it('非法定义在校验接口返回问题，保存时 WORKFLOW_DEFINITION_INVALID', async () => {
    const definition = {
      allowedRoles: ['developer', 'chef'],
      plannerRole: 'developer',
      requiredSteps: [{ key: 'v', title: 'V', roleKey: 'tester', instructions: 'x', dependsOn: [] }],
      checkpoints: { confirm_plan: false, accept_each_node: false },
      defaultAcceptance: { checks: [], manual: false },
    };
    const { body } = await t.call(validateWorkflowOp, { planning: 'ai', definition });
    expect(body.problems.map((p) => [p.code, p.field])).toEqual([
      ['ROLE_NOT_FOUND', 'allowedRoles'],
      ['PLANNER_ROLE_INVALID', 'plannerRole'],
      ['UNKNOWN_ROLE', 'requiredSteps'],
    ]);
    const created = await t.call(createWorkflowOp, {
      key: 'broken',
      name: 'Broken',
      planning: 'fixed',
      deliverable: 'code_changes',
      definition,
    });
    expect(created.body).toMatchObject({
      error: {
        code: ErrorCode.WorkflowDefinitionInvalid,
        details: { problems: [{ code: 'ROLE_NOT_FOUND' }, { code: 'MISSING_TEMPLATE' }] },
      },
    });
  });

  it('删除自定义流程：被任务引用的版本保留但不再列出，其余删除；内置流程不能删除', async () => {
    const bugfix = await builtin('bugfix');
    const v1 = (await t.call(createWorkflowOp, { copyFrom: bugfix.id, key: 'temp', name: 'Temp' })).body;
    const { project } = await addProject(t);
    await createTask(t, { projectId: project.id, workflow: 'temp', start: false });
    const v2 = (await t.call(updateWorkflowOp, { id: v1.id, name: 'Temp 2' })).body;

    expect((await t.call(deleteWorkflowOp, { key: 'temp' })).status).toBe(204);
    expect((await t.call(listWorkflowsOp, {})).body.items.map((w) => w.key)).not.toContain('temp');
    expect((await t.call(getWorkflowOp, { id: v1.id })).body).toMatchObject({ name: 'Temp' });
    expect((await t.call(getWorkflowOp, { id: v2.id })).body).toMatchObject({
      error: { code: ErrorCode.WorkflowNotFound },
    });
    expect((await t.call(deleteWorkflowOp, { key: 'bugfix' })).body).toMatchObject({
      error: { code: ErrorCode.WorkflowReadonly },
    });
    // The key can be used again; numbering continues after the kept version.
    const again = await t.call(createWorkflowOp, { copyFrom: bugfix.id, key: 'temp', name: 'Temp again' });
    expect(again.body).toMatchObject({ version: 2 });
  });
});

describe('自定义角色（M5-06）', () => {
  it('复制内置角色后可修改提示词与模型；键重复时 ROLE_ALREADY_EXISTS', async () => {
    const created = await t.call(createRoleOp, {
      copyFrom: await roleId('developer'),
      key: 'java_dev',
      name: 'Java 开发',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'java_dev', kind: 'custom', baseAgent: 'executor', model: null });
    const updated = await t.call(updateRoleOp, { id: created.body.id, prompt: 'Use Java 21.', model: 'p/m' });
    expect(updated.body).toMatchObject({ prompt: 'Use Java 21.', model: 'p/m' });
    expect(
      (await t.call(createRoleOp, { key: 'java_dev', name: 'x', baseAgent: 'executor', prompt: 'p' })).body,
    ).toMatchObject({ error: { code: ErrorCode.RoleAlreadyExists } });
    expect((await t.call(createRoleOp, { key: 'nothing', name: 'x' })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
  });

  it('被流程或任务步骤使用的角色不能删除；内置角色不能删除', async () => {
    const role = (await t.call(createRoleOp, { key: 'fixer', name: 'Fixer', baseAgent: 'executor', prompt: 'Fix.' }))
      .body;
    const bugfix = await builtin('bugfix');
    const template = {
      nodes: (bugfix.definition.template?.nodes ?? []).map((n) => ({ ...n, roleKey: 'fixer' })),
    };
    const workflow = (
      await t.call(createWorkflowOp, {
        key: 'fixer_flow',
        name: 'Fixer flow',
        planning: 'fixed',
        deliverable: 'code_changes',
        definition: { ...bugfix.definition, allowedRoles: ['fixer'], template },
      })
    ).body;
    expect((await t.call(deleteRoleOp, { id: role.id })).body).toMatchObject({
      error: { code: ErrorCode.RoleInUse, details: { workflows: ['fixer_flow'], usedByTasks: false } },
    });

    const { project } = await addProject(t, { checkCommand: null });
    const running = taskReaches(t, 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'fixer_flow' });
    await running;
    await t.call(deleteWorkflowOp, { key: workflow.key });
    expect((await t.call(deleteRoleOp, { id: role.id })).body).toMatchObject({
      error: { code: ErrorCode.RoleInUse, details: { workflows: [], usedByTasks: true } },
    });
    expect(task.workflow.key).toBe('fixer_flow');

    const unused = (await t.call(createRoleOp, { key: 'unused', name: 'U', baseAgent: 'reviewer', prompt: 'p' })).body;
    expect((await t.call(deleteRoleOp, { id: unused.id })).status).toBe(204);
    expect((await t.call(deleteRoleOp, { id: await roleId('tester') })).body).toMatchObject({
      error: { code: ErrorCode.RoleReadonly },
    });
  });
});
