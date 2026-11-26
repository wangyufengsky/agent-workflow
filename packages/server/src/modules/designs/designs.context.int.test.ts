import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  createInitiativeOp,
  createTaskOp,
  DesignStatus,
  getDesignOp,
  NodeStatus,
  reviseDesignSectionOp,
  startTaskOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, nodeReaches, workflowId } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createDesignsRepo } from './index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function seedDesign(projectId: string, title: string, ready: boolean, updatedAt: number) {
  const { status, body } = await t.call(createDesignOp, { projectId });
  expect(status).toBe(201);
  const db = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  try {
    const repo = createDesignsRepo(db.db);
    const sections = repo.listSections(body.id);
    expect(sections.length).toBeGreaterThan(1);
    repo.updateDesign(body.id, { outlineConfirmedAt: 1, updatedAt });
    sections.forEach((section, index) => {
      if (ready || index === 0) {
        repo.updateSection({ ...section, title, blocks: [{ type: 'markdown', markdown: '内部正文' }] });
      }
    });
  } finally {
    db.close();
  }
  expect((await t.call(getDesignOp, { id: body.id })).body.status).toBe(
    ready ? DesignStatus.Ready : DesignStatus.Incomplete,
  );
  return body.id;
}

async function firstBreakdown(projectId: string, requirement: string) {
  t.fake.enqueue(script().hang(), { agent: 'aw-code-reviewer' });
  const result = await t.call(createInitiativeOp, { projectId, baseBranch: 'release', requirement });
  expect(result.status).toBe(201);
  const prompt = t.fake.prompts.find(({ text }) => text.includes(requirement));
  if (prompt === undefined) throw new Error('Missing breakdown prompt');
  expect(t.fake.prompts.filter(({ sessionId }) => sessionId === prompt.sessionId)).toHaveLength(1);
  return prompt.text;
}

it('需求拆解选用实际基线分支的就绪设计，较新的未完成设计不覆盖精确匹配', async () => {
  const { project, repo } = await addProject(t, { files: { 'src/api.ts': 'export const version = 1;' } });
  const base = await repo.git('rev-parse', 'HEAD');
  await repo.git('branch', 'release');
  await seedDesign(project.id, '未完成设计章节', false, 30);
  expect(await firstBreakdown(project.id, '拆解没有就绪设计的需求')).not.toContain('<project-design-context>');
  const matching = await seedDesign(project.id, '发行分支已有交易章节', true, 10);
  const revising = await seedDesign(project.id, '正在修改的设计章节', true, 50);
  const section = (await t.call(getDesignOp, { id: revising })).body.sections[0];
  if (section === undefined) throw new Error('Missing section');
  t.fake.enqueue(script().hang(), { agent: 'aw-designer' });
  const revise = await t.call(reviseDesignSectionOp, {
    id: revising,
    sectionId: section.id,
    instruction: '补充接口关系',
  });
  expect(revise.status).toBe(200);
  expect(revise.body.status).toBe(DesignStatus.Generating);
  await writeFile(join(repo.path, 'src/api.ts'), 'export const version = 2;');
  await repo.git('commit', '-am', 'Advance checkout');
  await seedDesign(project.id, '其他版本就绪章节', true, 40);
  const prompt = await firstBreakdown(project.id, '拆解发行分支上的需求');
  expect(prompt).toContain(`"designId":"${matching}","match":"exact","baselineSha":"${base}"`);
  expect(prompt).toContain(`"targetSha":"${base}"`);
  expect(prompt).toContain('git show <targetSha>:<仓库相对路径>');
  expect(prompt).toContain('发行分支已有交易章节');
  expect(prompt).not.toContain('未完成设计章节');
  expect(prompt).not.toContain('正在修改的设计章节');
  expect(prompt).not.toContain('其他版本就绪章节');
  expect(prompt).not.toContain('内部正文');
});

it('详细设计只在启动步骤注入相对任务基线的参考目录', async () => {
  const { project, repo } = await addProject(t, { files: { 'src/api.ts': 'export const version = 1;' } });
  const oldSha = await repo.git('rev-parse', 'HEAD');
  const designId = await seedDesign(project.id, '旧版接口目录', true, 1);
  await writeFile(join(repo.path, 'src/api.ts'), 'export const version = 2;');
  await repo.git('commit', '-am', 'Change the worktree baseline');
  const { body: task, status } = await t.call(createTaskOp, {
    projectId: project.id,
    workflowId: await workflowId(t, 'detailed_design'),
    requirement: '写一份接口的详细设计',
    start: false,
  });
  expect(status).toBe(201);
  t.fake.enqueue(script().callTool('submit_result', { summary: '已梳理接口' }), { title: '· 梳理现状' });
  t.fake.enqueue(script().edit('api.md', '# 接口设计').callTool('submit_result', { summary: '设计已提交' }), {
    title: '· 编写详细设计',
  });
  const writing = nodeReaches(t, 'write', NodeStatus.Verifying);
  await t.call(startTaskOp, { id: task.id });
  await writing;
  const surveyPrompt = t.fake.prompts.find(({ text }) => text.includes('旧版接口目录'));
  expect(surveyPrompt?.text).toContain(`"designId":"${designId}","match":"reference","baselineSha":"${oldSha}"`);
  expect(t.fake.prompts.filter(({ text }) => text.includes('<project-design-context>'))).toHaveLength(1);
});
