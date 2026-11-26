import { BuiltinDesignTemplateKey } from '@aw/builtin';
import {
  AttemptKind,
  AttemptStatus,
  createDesignOp,
  createDesignTemplateOp,
  DesignLayoutStyle,
  DesignSectionKind,
  DesignStatus,
  DesignTemplateKind,
  deleteDesignOp,
  deleteDesignTemplateOp,
  deleteProjectOp,
  ErrorCode,
  generateDesignOp,
  getDesignOp,
  InboxKind,
  listDesignsOp,
  listDesignTemplatesOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  PermissionDecision,
  resolveInboxOp,
  ServerEventType,
  ThemeId,
  updateDesignOp,
  updateDesignOutlineOp,
  updateDesignTemplateOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, inboxOpens } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('通过 HTTP 轻量推荐、复制分析模板并保护设计引用的模板快照', async () => {
  const { project } = await addProject(t, {
    files: {
      'package.json': '{"dependencies":{"react":"*"}}',
      'src/app.ts': 'export const app = true;',
    },
  });
  const listed = await t.call(listDesignTemplatesOp, { projectId: project.id });
  expect(listed.status).toBe(200);
  expect(listed.body.suggested).toEqual({
    recommendedTemplateKey: BuiltinDesignTemplateKey.General,
    techStack: ['JavaScript', 'React'],
  });
  expect(listed.body.items).toMatchObject([
    { key: BuiltinDesignTemplateKey.DataExplorer, name: '数据模型与 SQL 链路探索', kind: DesignTemplateKind.Builtin },
    { key: BuiltinDesignTemplateKey.General, name: '架构探索', kind: DesignTemplateKind.Builtin },
    { key: BuiltinDesignTemplateKey.TransactionExplorer, name: '交易链路探索', kind: DesignTemplateKind.Builtin },
  ]);
  const base = listed.body.items.find((item) => item.key === BuiltinDesignTemplateKey.General);
  if (base === undefined) throw new Error('Built-in architecture template not found');

  const created = await t.call(createDesignTemplateOp, {
    baseKey: base.key,
    name: '前端设计',
    description: '面向组件的小型项目',
    defaultSections: [{ kind: DesignSectionKind.Overview, title: '页面总览', scopeHint: 'src' }],
    focusPrompt: '说明组件的用途',
  });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ kind: DesignTemplateKind.Custom, matchHints: base.matchHints });
  const key = created.body.key;

  const design = await t.call(createDesignOp, { projectId: project.id, templateKey: key });
  expect(design.status).toBe(201);
  expect(t.fake.sessions).toHaveLength(0);
  expect(design.body.sections).toMatchObject([{ title: '页面总览', scopePaths: ['src'], selected: true }]);
  const update = await t.call(updateDesignTemplateOp, { key, name: '新名字' });
  expect(update.status).toBe(200);
  expect(update.body.name).toBe('新名字');
  expect((await t.call(deleteDesignTemplateOp, { key })).status).toBe(204);

  const stale = await t.call(getDesignOp, { id: design.body.id });
  expect(stale.status).toBe(200);
  expect(stale.body.templateSnapshot.name).toBe('前端设计');
  expect(stale.body.templateName).toBe('前端设计');
  const missingTemplate = await t.call(updateDesignTemplateOp, { key, name: '失效引用' });
  expect(missingTemplate.status).toBe(404);
  expect(missingTemplate.body).toMatchObject({
    error: { code: ErrorCode.DesignNotFound, details: { templateKey: key } },
  });

  for (const result of [
    await t.call(updateDesignTemplateOp, { key: base.key, name: '改内置' }),
    await t.call(deleteDesignTemplateOp, { key: base.key }),
  ]) {
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: ErrorCode.DesignTemplateReadonly } });
  }
});

it('内置数据模型与 SQL 模板保留四章，多个源码目录不会展开额外章节', async () => {
  const { project } = await addProject(t, {
    files: {
      'db/migrations/001.sql': 'CREATE TABLE orders (id BIGINT PRIMARY KEY);',
      'src/api/orders.ts': 'export const endpoint = "/orders";',
      'src/mappers/orders.ts': 'export const table = "orders";',
    },
  });
  const key = BuiltinDesignTemplateKey.DataExplorer;
  const design = await t.call(createDesignOp, { projectId: project.id, templateKey: key });
  expect(design.status).toBe(201);
  expect(design.body.templateSnapshot).toMatchObject({ key, name: '数据模型与 SQL 链路探索' });
  expect(design.body.sections.map(({ title, selected }) => ({ title, selected }))).toEqual([
    { title: '数据架构总览', selected: true },
    { title: '核心实体与表结构', selected: true },
    { title: 'SQL 读写与映射热点', selected: true },
    { title: '事务边界与迁移风险', selected: true },
  ]);
  expect(t.fake.sessions).toHaveLength(0);
  const update = await t.call(updateDesignTemplateOp, { key, name: '改内置' });
  const remove = await t.call(deleteDesignTemplateOp, { key });
  for (const result of [update, remove]) {
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: ErrorCode.DesignTemplateReadonly } });
  }
});

it('项目设计列表支持中英文筛选、转义通配符和稳定翻页，项目删除后仍可读', async () => {
  const { project } = await addProject(t, { files: { 'src/index.ts': 'export const value = 1;' } });
  const other = await addProject(t, { files: { 'main.ts': 'export {};\n' } });
  async function create(projectId: string, title: string) {
    const draft = await t.call(createDesignOp, { projectId });
    expect(draft.status).toBe(201);
    const update = await t.call(updateDesignOp, { id: draft.body.id, title });
    expect(update.status).toBe(200);
    return update.body;
  }
  const needle = await create(project.id, '订单 API_% 设计');
  const similar = await create(project.id, '订单 apiAB 设计');
  const independent = await create(other.project.id, '订单 Api_% 设计');

  const { status, body: edited } = await t.call(updateDesignOutlineOp, {
    id: needle.id,
    sections: [
      { kind: DesignSectionKind.Overview, title: '选中', scopePaths: ['src'] },
      { kind: DesignSectionKind.Module, title: '排除', scopePaths: ['src'], selected: false },
    ],
  });
  expect(status).toBe(200);
  const subset = await t.call(listDesignsOp, { projectId: project.id, query: '订单 aPi_%' });
  expect(subset.status).toBe(200);
  expect(subset.body.items).toMatchObject([
    {
      id: needle.id,
      project: { id: project.id },
      totalSections: 1,
      doneSections: 0,
      status: DesignStatus.OutlineReady,
    },
  ]);
  expect(edited.sections.map((section) => section.selected)).toEqual([true, false]);
  const first = await t.call(listDesignsOp, { query: '订单 API', limit: 2 });
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(2);
  expect(first.body.nextCursor).toEqual(expect.any(String));
  if (first.body.nextCursor === null) throw new Error('First page does not have a cursor');
  const second = await t.call(listDesignsOp, { query: '订单 API', limit: 2, cursor: first.body.nextCursor });
  expect(second.body.nextCursor).toBeNull();
  expect([...first.body.items, ...second.body.items].map(({ id }) => id).sort()).toEqual(
    [needle.id, similar.id, independent.id].sort(),
  );

  const deleted = await t.call(deleteProjectOp, { id: project.id });
  expect(deleted.status).toBe(204);
  const detached = await t.call(getDesignOp, { id: needle.id });
  expect(detached.status).toBe(200);
  expect(detached.body).toMatchObject({ projectId: null, project: null, totalSections: 1 });
  const readonly = await t.call(updateDesignOp, { id: needle.id, theme: ThemeId.Dracula });
  expect(readonly.raw.json()).toMatchObject({ error: { code: ErrorCode.StateTransitionInvalid } });
});

it('生成过程中从 HTTP 切换阅读设置，原有尝试继续写入章节', async () => {
  const { project } = await addProject(t, { files: { 'src/index.ts': 'export const value = 1;' } });
  const {
    body: { id },
  } = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: false });
  const outline = await t.call(updateDesignOutlineOp, {
    id,
    sections: [
      { kind: DesignSectionKind.Overview, title: '总览', scopePaths: [] },
      { kind: DesignSectionKind.Module, title: '模块', scopePaths: ['src'] },
    ],
  });
  const [overview, module] = outline.body.sections;
  if (overview === undefined || module === undefined) throw new Error('Expected two working chapters');
  const submit = (sectionId: string, summary: string) => ({
    sectionId,
    summary,
    blocks: [{ type: 'markdown', markdown: summary }],
    files: [],
    diagrams: [],
  });
  const waiting = inboxOpens(t, InboxKind.Permission);
  const designer = { agent: OPENCODE_AGENT_NAME.designer };
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, submit(overview.id, '总览已提交')), designer);
  t.fake.enqueue(
    script()
      .requestPermission('bash', ['rg -n value src/index.ts'])
      .callTool(McpToolName.SubmitDesignSection, submit(module.id, '模块已提交')),
    designer,
  );
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  const { item } = await waiting;
  const before = (await t.call(getDesignOp, { id })).body;
  expect(before).toMatchObject({ status: DesignStatus.Generating, doneSections: 1 });
  const finishingAttempt = before.runs.at(-1)?.attempt.id;
  const finished = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    ({ attempt }) =>
      attempt.id === finishingAttempt &&
      attempt.kind === AttemptKind.DesignGenerate &&
      attempt.status === AttemptStatus.Succeeded,
  );

  const updated = await t.call(updateDesignOp, { id, theme: ThemeId.Dracula, layoutStyle: DesignLayoutStyle.Arch });
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({
    status: DesignStatus.Generating,
    doneSections: 1,
    activeRunId: before.activeRunId,
    theme: ThemeId.Dracula,
    layoutStyle: DesignLayoutStyle.Arch,
  });
  expect(updated.body.runs.map(({ attempt }) => attempt.id)).toEqual(before.runs.map(({ attempt }) => attempt.id));
  for (const response of [
    await t.call(updateDesignOp, { id, theme: ThemeId.Codex, title: '运行中不改名' }),
    await t.call(updateDesignOp, { id, aiReviewEnabled: true }),
    await t.call(generateDesignOp, { id }),
    await t.call(deleteDesignOp, { id }),
  ]) {
    expect(response.status).toBe(409);
    expect(response.raw.json()).toMatchObject({ error: { code: ErrorCode.DesignBusy } });
  }

  expect((await t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Once } })).status).toBe(
    200,
  );
  await finished;
  const completed = (await t.call(getDesignOp, { id })).body;
  expect(completed).toMatchObject({
    status: DesignStatus.Ready,
    doneSections: 2,
    theme: ThemeId.Dracula,
    layoutStyle: DesignLayoutStyle.Arch,
    sections: [{ summary: '总览已提交' }, { summary: '模块已提交' }],
  });
  expect(completed.runs.map(({ attempt }) => attempt.id)).toEqual(before.runs.map(({ attempt }) => attempt.id));
  expect(t.fake.prompts).toHaveLength(2);
});
