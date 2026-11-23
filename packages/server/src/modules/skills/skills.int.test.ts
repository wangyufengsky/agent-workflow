import { randomUUID } from 'node:crypto';
import {
  ARTIFACT_WORKFLOW_KEY,
  AssistantForm,
  AssistantPage,
  AssistantToolName,
  createConversationOp,
  createSkillOp,
  createWorkflowOp,
  deleteSkillOp,
  deleteWorkflowOp,
  ErrorCode,
  getSkillCatalogOp,
  getTaskOp,
  listProjectSkillBindingsOp,
  listRolesOp,
  listSkillsOp,
  ServerEventType,
  sendAssistantMessageOp,
  setProjectSkillBindingOp,
  setSkillScopeOp,
  startTaskOp,
  TaskStatus,
  updateSkillOp,
  updateWorkflowOp,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';

const skillMarkdown = (name: string, procedure: string) =>
  `---\nname: ${name}\ndescription: >-\n  用于编写运营复盘。\n  仅在确认数据之后使用。\nmetadata:\n  team: sales\n---\n\n${procedure}`;

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

describe('我的 Skill', () => {
  it('保存 YAML 与正文，拒绝无效、重名及已不存在的 Skill', async () => {
    const source = skillMarkdown('monthly-review', '在开头注明统计周期。');
    const created = await app.call(createSkillOp, { source });
    expect(created.status).toBe(201);
    const { id } = created.body;
    expect((await app.call(listSkillsOp, {})).body.items).toEqual([
      {
        id,
        name: 'monthly-review',
        description: '用于编写运营复盘。 仅在确认数据之后使用。',
        version: 1,
        source,
        assistantEnabled: true,
      },
    ]);
    expect((await app.call(createSkillOp, { source })).body).toMatchObject({
      error: { code: ErrorCode.SkillNameTaken },
    });
    expect(
      (await app.call(createSkillOp, { source: source.replace('monthly-review', 'aw-monthly') })).body,
    ).toMatchObject({ error: { code: ErrorCode.SkillInvalid } });
    expect((await app.call(updateSkillOp, { id: randomUUID(), source })).body).toMatchObject({
      error: { code: ErrorCode.SkillNotFound },
    });
    expect((await app.call(deleteSkillOp, { id: randomUUID() })).body).toMatchObject({
      error: { code: ErrorCode.SkillNotFound },
    });
  });

  it('绑定按项目和流程生效，任务启动和重读时使用冻结的 Skill 版本', async () => {
    const { project } = await addProject(app);
    const one = (await app.call(createSkillOp, { source: skillMarkdown('report-style', '版本一：先写结论。') })).body;
    const binding = { projectId: project.id, workflowKey: ARTIFACT_WORKFLOW_KEY, skillIds: [one.id] };
    expect((await app.call(setProjectSkillBindingOp, { ...binding, skillIds: [randomUUID()] })).body).toMatchObject({
      error: { code: ErrorCode.SkillNotFound },
    });
    expect((await app.call(setProjectSkillBindingOp, { ...binding, workflowKey: 'missing' })).body).toMatchObject({
      error: { code: ErrorCode.WorkflowNotFound },
    });
    expect((await app.call(setProjectSkillBindingOp, binding)).body).toEqual(binding);
    expect((await app.call(listProjectSkillBindingsOp, { projectId: project.id })).body.items).toEqual([binding]);
    const other = await createTask(app, { projectId: project.id, workflow: 'feature', start: false });
    expect(other.skills).toBeUndefined();
    const task = await createTask(app, { projectId: project.id, workflow: ARTIFACT_WORKFLOW_KEY, start: false });
    expect(task.skills).toEqual([{ id: one.id, name: 'report-style', version: 1 }]);

    const { body: two } = await app.call(updateSkillOp, {
      id: one.id,
      source: skillMarkdown('report-style', '版本二：先写范围。'),
    });
    expect(two.version).toBe(2);
    const next = await createTask(app, { projectId: project.id, workflow: ARTIFACT_WORKFLOW_KEY, start: false });
    expect(next.skills).toEqual([{ id: one.id, name: 'report-style', version: 2 }]);
    expect((await app.call(deleteSkillOp, { id: one.id })).status).toBe(204);
    expect((await app.call(listProjectSkillBindingsOp, { projectId: project.id })).body.items).toEqual([]);

    app.fake.enqueue(
      script()
        .callTool('write_task_text', { file: 'report.md', text: '# 结论' })
        .callTool('submit_result', { summary: '已生成报告' }),
      { title: '生成首版产物' },
    );
    const review = taskReaches(app, TaskStatus.Review);
    await app.call(startTaskOp, { id: task.id });
    await review;
    const prompt = app.fake.prompts.at(-1)?.system;
    expect(prompt).toContain('report-style (v1)');
    expect(prompt).toContain('版本一：先写结论。');
    expect(prompt).not.toContain('版本二：先写范围。');
    expect((await app.call(getTaskOp, { id: task.id })).body.skills).toEqual(task.skills);
  });

  it('自定义流程发布新版本时保留绑定，删除后清除绑定', async () => {
    const { project } = await addProject(app);
    const { body: skill } = await app.call(createSkillOp, { source: skillMarkdown('draft-review', '对照统计周期。') });
    const input = { key: 'draft_report', name: '草稿复盘', copyFrom: await workflowId(app, 'feature') };
    const { body: workflow } = await app.call(createWorkflowOp, input);
    const binding = { projectId: project.id, workflowKey: input.key, skillIds: [skill.id] };
    await app.call(setProjectSkillBindingOp, binding);
    const { body: revised } = await app.call(updateWorkflowOp, { id: workflow.id, name: '复盘流程' });
    const task = await createTask(app, { projectId: project.id, workflow: input.key, start: false });
    expect(task.workflow.id).toBe(revised.id);
    expect(task.skills).toEqual([{ id: skill.id, name: skill.name, version: 1 }]);

    expect((await app.call(deleteWorkflowOp, { key: input.key })).status).toBe(204);
    expect((await app.call(listProjectSkillBindingsOp, { projectId: project.id })).body.items).toEqual([]);
    expect((await app.call(createWorkflowOp, input)).status).toBe(201);
    const next = await createTask(app, { projectId: project.id, workflow: input.key, start: false });
    expect(next.skills).toBeUndefined();
  });

  it('目录返回内置正文和运行时使用对象', async () => {
    const response = await app.call(getSkillCatalogOp, {});
    expect(response.status).toBe(200);
    const { builtin, scopes } = response.body;
    expect(builtin).toHaveLength(19);
    expect(builtin.find(({ name }) => name === 'aw-functional-testing')).toMatchObject({
      source: expect.stringContaining('test_case_revise'),
      assistantEnabled: false,
      agents: [],
      workflows: ['functional_test'],
    });
    expect(builtin.find(({ name }) => name === 'aw-submit-result')).toMatchObject({
      source: expect.stringContaining('agent-workflow_get_submission_guide'),
      assistantEnabled: false,
      agents: ['planner', 'executor', 'reviewer'],
    });
    expect(builtin.find(({ name }) => name === 'aw-image-analysis')).toMatchObject({
      source: expect.stringContaining('agent-workflow_analyze_image'),
      assistantEnabled: true,
      agents: ['planner', 'executor', 'reviewer', 'code_reviewer'],
    });
    expect(builtin.find(({ name }) => name === 'aw-page-check')).toMatchObject({
      source: expect.stringContaining('name: aw-page-check'),
      assistantEnabled: false,
      agents: ['planner', 'executor', 'reviewer'],
    });
    expect(builtin.find(({ name }) => name === 'aw-db-readonly')).toMatchObject({
      assistantEnabled: true,
      agents: ['planner', 'executor', 'reviewer', 'researcher'],
    });
    expect(builtin.find(({ name }) => name === 'aw-code-review')).toMatchObject({
      source: expect.stringContaining('name: aw-code-review'),
      assistantEnabled: false,
      agents: ['reviewer', 'code_reviewer'],
    });
    expect(builtin).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'aw-assistant-memory',
          source: expect.stringContaining('name: aw-assistant-memory'),
          assistantEnabled: true,
          agents: [],
        }),
        expect.objectContaining({ name: 'aw-task-delivery', assistantEnabled: true, agents: [] }),
        ...['aw-artifact-revision', 'aw-backend-development', 'aw-frontend-development'].map((name) =>
          expect.objectContaining({ name, assistantEnabled: false, agents: ['executor'] }),
        ),
      ]),
    );
    expect(scopes).toEqual([]);
  });

  it('同为执行角色时仍按角色 ID 隔离，并在任务创建时冻结绑定', async () => {
    const { project } = await addProject(app);
    const { body: listed } = await app.call(listRolesOp, {});
    const developer = listed.items.find(({ key }) => key === 'developer');
    const tester = listed.items.find(({ key }) => key === 'tester');
    if (developer === undefined || tester === undefined) throw new Error('Missing roles');

    const workflow = await app.call(createWorkflowOp, {
      key: 'role_skill_test',
      name: '限定角色的流程',
      planning: WorkflowPlanning.Fixed,
      deliverable: WorkflowDeliverable.Report,
      definition: {
        allowedRoles: [developer.key, tester.key],
        template: {
          nodes: [
            { key: 'implement', title: '实现步骤', roleKey: developer.key, instructions: '按计划处理', dependsOn: [] },
            { key: 'test', title: '测试步骤', roleKey: tester.key, instructions: '进行复核', dependsOn: ['implement'] },
          ],
        },
        checkpoints: { confirm_plan: false, accept_each_node: false },
        defaultAcceptance: { checks: [], manual: false },
      },
    });
    expect(workflow.status).toBe(201);
    const { body: skill } = await app.call(createSkillOp, {
      source: skillMarkdown('role-procedure', '仅指定角色执行口径确认。'),
    });
    const scope = {
      id: skill.id,
      assistantEnabled: false,
      bindings: [{ projectId: project.id, workflowKey: workflow.body.key, roleIds: [developer.id] }],
    };
    expect((await app.call(setSkillScopeOp, scope)).body).toEqual(scope);
    expect((await app.call(getSkillCatalogOp, {})).body.scopes).toEqual([scope]);
    const projectBinding = { projectId: project.id, workflowKey: workflow.body.key, skillIds: [skill.id] };
    await app.call(setProjectSkillBindingOp, projectBinding);
    expect((await app.call(getSkillCatalogOp, {})).body.scopes).toEqual([scope]);

    const task = await createTask(app, { projectId: project.id, workflow: workflow.body.key, start: false });
    const otherRole = {
      ...scope,
      bindings: [{ projectId: project.id, workflowKey: workflow.body.key, roleIds: [tester.id] }],
    };
    expect((await app.call(setSkillScopeOp, otherRole)).body).toEqual(otherRole);
    const review = taskReaches(app, TaskStatus.Review);
    app.fake.enqueue(script().callTool('submit_result', { summary: '已实现' }), { title: '实现步骤' });
    app.fake.enqueue(script().callTool('submit_result', { summary: '已复核' }), { title: '测试步骤' });
    expect((await app.call(startTaskOp, { id: task.id })).status).toBe(200);
    await review;
    const getPrompt = (title: string) => {
      const session = app.fake.sessions.find((item) => item.title.endsWith(title));
      return app.fake.prompts.find((item) => item.sessionId === session?.id)?.system;
    };
    expect(getPrompt('实现步骤')).toContain('仅指定角色执行口径确认。');
    expect(getPrompt('测试步骤')).toBeDefined();
    expect(getPrompt('测试步骤')).not.toContain('仅指定角色执行口径确认。');

    const { body: conversation } = await app.call(createConversationOp, {});
    expect(
      (
        await app.call(sendAssistantMessageOp, {
          id: conversation.id,
          context: { page: AssistantPage.Skills, params: {} },
          text: '使用这条 Skill',
          skillIds: [skill.id],
        })
      ).body,
    ).toMatchObject({ error: { code: ErrorCode.SkillAssistantDisabled } });
    expect(
      (
        await app.call(setSkillScopeOp, {
          ...scope,
          bindings: [{ projectId: project.id, workflowKey: workflow.body.key, roleIds: [randomUUID()] }],
        })
      ).body,
    ).toMatchObject({ error: { code: ErrorCode.RoleNotFound } });
    expect((await app.call(getSkillCatalogOp, {})).body.scopes).toEqual([otherRole]);
  });

  it('助手只为所选消息加载 Skill，提炼出的草稿留给用户保存', async () => {
    const { body: one } = await app.call(createSkillOp, { source: skillMarkdown('team-report', '用固定统计口径。') });
    const { body: conversation } = await app.call(createConversationOp, {});
    const message = { id: conversation.id, context: { page: AssistantPage.Home, params: {} } };
    const idle = () =>
      waitForEvent(app.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversation.id && !c.busy);
    const ready = idle();
    expect(
      (await app.call(sendAssistantMessageOp, { ...message, text: '整理本期复盘', skillIds: [one.id] })).status,
    ).toBe(200);
    await ready;
    expect(app.fake.prompts.at(-1)?.system).toContain('### team-report (v1)\n\n用固定统计口径。');
    const source = skillMarkdown('reusable-report', '先核对统计周期，再按渠道列出实绩。');
    app.fake.enqueue(
      script().callAppTool(AssistantToolName.OpenForm, { form: AssistantForm.CreateSkill, values: { source } }),
    );
    const opened = waitForEvent(app.app.events, ServerEventType.AssistantOpenForm);
    const ended = idle();
    await app.call(sendAssistantMessageOp, { ...message, text: '把刚才的操作提炼成 Skill' });
    expect(await opened).toEqual({
      conversationId: conversation.id,
      form: AssistantForm.CreateSkill,
      values: { source },
    });
    await ended;
    expect(app.fake.prompts.at(-1)?.system).not.toContain('### team-report (v1)');
    expect((await app.call(listSkillsOp, {})).body.items.map(({ name }) => name)).toEqual(['team-report']);
    expect(
      (await app.call(sendAssistantMessageOp, { ...message, text: '重试', skillIds: [randomUUID()] })).body,
    ).toMatchObject({ error: { code: ErrorCode.SkillNotFound } });
  });
});
