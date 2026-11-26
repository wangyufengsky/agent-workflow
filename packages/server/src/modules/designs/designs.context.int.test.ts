import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  askKnowledgeOp,
  createDbConnectionOp,
  createDesignOp,
  createInitiativeOp,
  createTaskOp,
  DbTlsMode,
  DbType,
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignStatus,
  followUpKnowledgeOp,
  getDesignOp,
  getKnowledgeOp,
  type KnowledgeSources,
  KnowledgeTurnStatus,
  McpToolName,
  NodeStatus,
  OPENCODE_AGENT_NAME,
  PROJECT_DESIGN_CONTEXT_MAX_BYTES,
  reviseDesignSectionOp,
  setProjectDbConnectionsOp,
  startTaskOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { addProject, nodeReaches, workflowId } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createDesignsRepo } from './index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ cipher: testCipher });
});
afterEach(() => t.close());

async function seedDesign(projectId: string, title: string, ready: boolean, updatedAt: number, graph = false) {
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
        const evidence = [{ evidenceClass: DesignEvidenceClass.Inferred, rationale: '内部关系推断细节' }];
        const diagramId = `refund-${body.id}`;
        repo.updateSection({
          ...section,
          title,
          blocks: [
            { type: 'markdown', markdown: '内部正文' },
            ...(graph && index === 0
              ? [
                  {
                    type: 'submodule' as const,
                    id: 'settlement',
                    title: '结算模块',
                    summary: '内部模块说明',
                    files: ['src/api.ts'],
                    behaviors: [{ title: '计算', markdown: '内部行为说明', evidence }],
                  },
                  { type: 'transaction' as const, title: '退款交易', code: 'REFUND', diagramId, evidence },
                ]
              : []),
          ],
        });
        if (graph && index === 0) {
          repo.insertDiagrams([
            {
              id: diagramId,
              designId: body.id,
              sectionId: section.id,
              updatedAt,
              kind: DesignDiagramKind.BusinessFlow,
              title: '退款调用',
              nodes: [
                { id: 'refund', label: '退款入口' },
                { id: 'fee', label: '费率计算' },
              ],
              edges: Array.from({ length: 100 }, (_, edge) => ({
                id: `edge-${edge}`,
                from: 'refund',
                to: 'fee',
                kind: 'calls',
                label: edge === 0 ? '退款调用费率' : '费率处理依赖关系'.repeat(19),
                evidenceClass: DesignEvidenceClass.Inferred,
                rationale: '内部关系推断细节',
              })),
            },
          ]);
        }
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

const researcher = { agent: OPENCODE_AGENT_NAME.researcher };
const codeOnly: KnowledgeSources = { code: true, docs: false, database: false, web: false };

const answer = () => script().callTool(McpToolName.SubmitAnswer, { answer: '已核对。', citations: [] });

function researchPrompt(question: string) {
  const prompt = t.fake.prompts.find(({ text }) => text.includes(question));
  if (prompt === undefined) throw new Error('Missing research prompt');
  expect(prompt.agent).toBe(researcher.agent);
  return prompt;
}

async function askWithSources(projectId: string, question: string, sources = codeOnly) {
  t.fake.enqueue(answer(), researcher);
  const result = await t.call(askKnowledgeOp, { projectId, question, sources });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  await t.fake.settled();
  return { conversation: result.body, prompt: researchPrompt(question) };
}

it('知识问答首轮注入包含交易与关系的限长参考目录，续问沿用研究员会话且不再注入', async () => {
  const { project, repo } = await addProject(t, { files: { 'src/api.ts': 'export const version = 1;' } });
  const baseline = await repo.git('rev-parse', 'HEAD');
  const designId = await seedDesign(project.id, '支付项目设计章节', true, 10, true);
  await seedDesign(project.id, '未就绪资料不能进入问答', false, 30);
  const design = (await t.call(getDesignOp, { id: designId })).body;
  const { conversation, prompt } = await askWithSources(project.id, '哪些交易会调用费率计算？');
  const context = /\n\n<project-design-context>[\s\S]+?<\/project-design-context>/.exec(prompt.text)?.[0];
  if (context === undefined) throw new Error('Missing project design context');
  expect(Buffer.byteLength(context, 'utf8')).toBeLessThanOrEqual(PROJECT_DESIGN_CONTEXT_MAX_BYTES);
  expect(context).toContain('目录摘要已截断。');
  const entries = context
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  expect(entries).toContainEqual(
    expect.objectContaining({
      designId,
      match: 'reference',
      baselineSha: baseline,
      targetSha: null,
      dirty: false,
      coverage: { doneSections: design.doneSections, totalSections: design.totalSections },
    }),
  );
  expect(entries).toContainEqual(expect.objectContaining({ title: '支付项目设计章节' }));
  expect(entries).toContainEqual(expect.objectContaining({ module: '结算模块' }));
  expect(entries).toContainEqual(expect.objectContaining({ transaction: '退款交易', code: 'REFUND' }));
  expect(entries).toContainEqual(
    expect.objectContaining({
      dependency: '退款调用费率',
      from: '退款入口',
      to: '费率计算',
    }),
  );
  expect(context).not.toMatch(/未就绪资料不能进入问答|内部正文|内部关系推断细节/);

  t.fake.enqueue(answer(), researcher);
  const followUp = '退款异常出口在哪里？';
  expect((await t.call(followUpKnowledgeOp, { id: conversation.id, question: followUp })).status).toBe(200);
  await t.fake.settled();
  const second = researchPrompt(followUp);
  expect(second.sessionId).toBe(prompt.sessionId);
  expect(second.text).not.toContain('<project-design-context>');
  expect(t.fake.sessions).toMatchObject([{ id: prompt.sessionId, agent: researcher.agent, directory: repo.path }]);
  expect((await t.call(getKnowledgeOp, { id: conversation.id })).body.turns.map(({ status }) => status)).toEqual([
    KnowledgeTurnStatus.Answered,
    KnowledgeTurnStatus.Answered,
  ]);
});

it('无就绪设计时省略目录，有就绪设计时仍尊重文档与数据库的来源选择', async () => {
  const { project } = await addProject(t, { files: { 'src/api.ts': 'export const version = 1;' } });
  const without = await askWithSources(project.id, '没有设计时提问');
  expect(without.prompt.text).not.toContain('<project-design-context>');
  await seedDesign(project.id, '只有未完成的设计章节', false, 1);
  const draftOnly = await askWithSources(project.id, '只有未完成设计时提问');
  expect(draftOnly.prompt.text).not.toContain('<project-design-context>');

  await seedDesign(project.id, '就绪资料章节', true, 2);
  const docs = await askWithSources(project.id, '只看文档里的说明', { ...codeOnly, code: false, docs: true });
  expect(docs.prompt.text).toContain('<project-design-context>');
  expect(docs.prompt.text).toContain('就绪资料章节');
  expect(docs.prompt.text).toContain('- Code (source files): no');
  expect(docs.prompt.text).not.toContain('git show');

  const connection = await t.call(createDbConnectionOp, {
    name: 'source-scope-fixture',
    type: DbType.Mysql,
    host: '127.0.0.1',
    port: 3306,
    database: 'fixture',
    username: 'read_only',
    password: '',
    tlsMode: DbTlsMode.Off,
  });
  expect(connection.status).toBe(201);
  expect(
    (await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [connection.body.id] })).status,
  ).toBe(200);
  const database = await askWithSources(project.id, '只使用已关联数据库', { ...codeOnly, code: false, database: true });
  expect(database.prompt.text).toContain('source-scope-fixture');
  expect(database.prompt.text).not.toContain('<project-design-context>');
  expect(t.fake.sessions.map(({ agent }) => agent)).toEqual(Array.from({ length: 4 }, () => researcher.agent));
});
