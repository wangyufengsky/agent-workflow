import { BuiltinDesignTemplateKey } from '@aw/builtin';
import {
  createDesignOp,
  createDesignTemplateOp,
  DesignSectionKind,
  DesignStatus,
  DesignTemplateKind,
  deleteDesignTemplateOp,
  deleteProjectOp,
  ErrorCode,
  getDesignOp,
  listDesignsOp,
  listDesignTemplatesOp,
  updateDesignOp,
  updateDesignOutlineOp,
  updateDesignTemplateOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

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
    recommendedTemplateKey: BuiltinDesignTemplateKey.ReactFrontend,
    techStack: ['JavaScript', 'React'],
  });
  const base = listed.body.items.find((item) => item.key === BuiltinDesignTemplateKey.ReactFrontend);
  if (base === undefined) throw new Error('React template not found');

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
});
