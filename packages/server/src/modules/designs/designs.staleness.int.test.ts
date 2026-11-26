import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  DesignSectionKind,
  DesignStalenessState,
  deleteProjectOp,
  ErrorCode,
  generateDesignOp,
  getDesignStalenessOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('干净快照在同一 HEAD 上无变化，未跟踪文件即使被 Git 配置隐藏也可检出', async () => {
  const { project, repo } = await addProject(t, { files: { 'src/initial.ts': 'export {};' } });
  await repo.git('config', 'status.showUntrackedFiles', 'no');
  const { status, body: design } = await t.call(createDesignOp, { projectId: project.id });
  expect(status).toBe(201);
  const sha = await repo.git('rev-parse', 'HEAD');
  expect(design.sourceSnapshot).toMatchObject({ commitSha: sha, dirty: false });
  const fresh = await t.call(getDesignStalenessOp, { id: design.id });
  expect(fresh.status).toBe(200);
  expect(fresh.body).toEqual({
    state: DesignStalenessState.Fresh,
    baseSha: sha,
    headSha: sha,
    changedFilesCount: 0,
    affectedSectionIds: [],
    changedPathsSample: [],
  });

  await writeFile(join(repo.path, 'src/untracked.ts'), 'export {};');
  const stale = await t.call(getDesignStalenessOp, { id: design.id });
  expect(stale.status).toBe(200);
  expect(stale.body).toMatchObject({
    state: DesignStalenessState.Stale,
    baseSha: sha,
    headSha: sha,
    changedFilesCount: 1,
    changedPathsSample: ['src/untracked.ts'],
  });
  expect(t.fake.sessions).toHaveLength(0);
});

it('新提交修改共享源码时返回两个提交和所有受影响的已生成章节', async () => {
  const relPath = 'src/initial.ts';
  const { project, repo } = await addProject(t, { files: { [relPath]: 'export const version = 1;\n' } });
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: false });
  const { id } = design;
  const { body: outlined } = await t.call(updateDesignOutlineOp, {
    id,
    sections: [
      { kind: DesignSectionKind.Module, title: '模块实现', scopePaths: ['src'] },
      { kind: DesignSectionKind.Overview, title: '入口总览', scopePaths: [relPath] },
    ],
  });
  const [module, overview] = outlined.sections;
  if (module === undefined || overview === undefined) throw new Error('Expected module and overview sections');
  const designer = { agent: OPENCODE_AGENT_NAME.designer };
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: module.id,
      summary: '模块实现',
      blocks: [{ type: 'markdown', markdown: '模块实现' }],
      files: [{ relPath, responsibility: '导出版本', symbols: [] }],
      diagrams: [],
    }),
    designer,
  );
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: overview.id,
      summary: '入口总览',
      blocks: [
        { type: 'code', language: 'typescript', relPath, lineStart: 1, lineEnd: 1, code: 'export const version = 1;' },
      ],
      files: [],
      diagrams: [],
    }),
    designer,
  );
  const finished = waitForEvent(
    t.app.events,
    ServerEventType.DesignUpdated,
    ({ designId }) => designId === id && t.app.services.designs.get(id).doneSections === 2,
  );
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await finished;

  await writeFile(join(repo.path, relPath), 'export const version = 2;\n');
  await repo.git('commit', '-am', 'update version');
  const headSha = await repo.git('rev-parse', 'HEAD');
  const stale = await t.call(getDesignStalenessOp, { id });
  expect(stale.status).toBe(200);
  expect(stale.body).toEqual({
    state: DesignStalenessState.Stale,
    baseSha: design.sourceSnapshot.commitSha,
    headSha,
    changedFilesCount: 1,
    affectedSectionIds: [module.id, overview.id],
    changedPathsSample: [relPath],
  });
});

it('从脏快照恢复已提交内容后按哈希统计增删改，并按目录边界映射未生成章节', async () => {
  const { project, repo } = await addProject(t, {
    files: {
      'src/service.ts': 'export const version = 1;',
      'src/utility/untouched.ts': 'export {};',
      'src/utility-extra/old.ts': 'export {};',
      'scratch.txt': 'ignore',
    },
  });
  await writeFile(join(repo.path, 'src/service.ts'), 'export const version = 2;');
  await writeFile(join(repo.path, 'src/utility-extra/draft.ts'), 'export {};');
  await rm(join(repo.path, 'src/utility-extra/old.ts'));
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, excludePatterns: ['scratch.txt'] });
  const { body: outlined } = await t.call(updateDesignOutlineOp, {
    id: design.id,
    sections: [
      { kind: DesignSectionKind.Module, title: '源码', scopePaths: ['src'] },
      { kind: DesignSectionKind.Module, title: '工具', scopePaths: ['src/utility'] },
      { kind: DesignSectionKind.Module, title: '草稿', scopePaths: ['src/utility-extra/draft.ts'] },
      { kind: DesignSectionKind.Module, title: '未勾选', scopePaths: ['src'], selected: false },
    ],
  });
  expect(design.sourceSnapshot.dirty).toBe(true);
  const srcSection = outlined.sections.find(({ title }) => title === '源码');
  const draftSection = outlined.sections.find(({ title }) => title === '草稿');
  if (srcSection === undefined || draftSection === undefined) throw new Error('Expected source and draft sections');

  await repo.git('restore', '--', 'src');
  await rm(join(repo.path, 'src/utility-extra/draft.ts'));
  const restored = await t.call(getDesignStalenessOp, { id: design.id });
  expect(restored.status).toBe(200);
  expect(restored.body).toEqual({
    state: DesignStalenessState.Stale,
    baseSha: design.sourceSnapshot.commitSha,
    headSha: design.sourceSnapshot.commitSha,
    changedFilesCount: 3,
    affectedSectionIds: [srcSection.id, draftSection.id],
    changedPathsSample: ['src/service.ts', 'src/utility-extra/draft.ts', 'src/utility-extra/old.ts'],
  });

  await writeFile(join(repo.path, 'scratch.txt'), 'updated and still excluded');
  await mkdir(join(repo.path, 'node_modules'));
  await writeFile(join(repo.path, 'node_modules/ignored.ts'), 'export {};');
  const withExcludedChanges = await t.call(getDesignStalenessOp, { id: design.id });
  expect(withExcludedChanges.body).toEqual(restored.body);
});

it('无 Git 元数据时比对文件内容，移走项目目录与解除关联后分别给出原因', async () => {
  const { project, repo } = await addProject(t, { files: { 'package.json': '{"dependencies":{}}' } });
  const { body: design } = await t.call(createDesignOp, { projectId: project.id });
  await rename(join(repo.path, '.git'), `${repo.path}-git`);
  const id = design.id;

  const fresh = await t.call(getDesignStalenessOp, { id });
  expect(fresh.status).toBe(200);
  expect(fresh.body).toMatchObject({ state: DesignStalenessState.Fresh, changedFilesCount: 0 });
  expect(fresh.body).not.toHaveProperty('headSha');

  await writeFile(join(repo.path, 'package.json'), '{');
  const stale = await t.call(getDesignStalenessOp, { id });
  expect(stale.status).toBe(200);
  expect(stale.body).toMatchObject({
    state: DesignStalenessState.Stale,
    changedFilesCount: 1,
    changedPathsSample: ['package.json'],
  });
  expect(stale.body).not.toHaveProperty('headSha');
  expect(stale.body.baseSha).toBe(design.sourceSnapshot.commitSha);

  await rename(repo.path, `${repo.path}-relocated`);
  const unavailable = await t.call(getDesignStalenessOp, { id });
  expect(unavailable.status).toBe(200);
  expect(unavailable.body).toMatchObject({
    state: DesignStalenessState.Unknown,
    reason: 'directory_unavailable',
    changedFilesCount: 0,
  });
  expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
  const unbound = await t.call(getDesignStalenessOp, { id });
  expect(unbound.status).toBe(200);
  expect(unbound.body).toMatchObject({ state: DesignStalenessState.Unknown, reason: 'project_unbound' });
});

it('不存在的设计返回 DESIGN_NOT_FOUND', async () => {
  const response = await t.call(getDesignStalenessOp, { id: 'missing' });
  expect(response.status).toBe(404);
  expect(response.raw.json()).toMatchObject({ error: { code: ErrorCode.DesignNotFound } });
});
