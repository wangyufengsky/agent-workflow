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
  getTaskOp,
  listProjectSkillBindingsOp,
  listSkillsOp,
  ServerEventType,
  sendAssistantMessageOp,
  setProjectSkillBindingOp,
  startTaskOp,
  TaskStatus,
  updateSkillOp,
  updateWorkflowOp,
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
      { id, name: 'monthly-review', description: '用于编写运营复盘。 仅在确认数据之后使用。', version: 1, source },
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
