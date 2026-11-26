import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_EXPLORER_KEY,
  type DesignBlock,
  type DesignDiagram,
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DesignStatus,
  GitImpactClassification,
  GitImpactTargetKind,
  GitReviewTarget,
  getDesignOp,
  getProjectOp,
  gitReviewSchema,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ThemeId,
  TranscriptEntryKind,
  transcriptPageSchema,
} from '@aw/shared';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, type FakeStep, git, patchSettings, queueCodeReviewerTurn } from './helpers.ts';

const orders = 'create-orders.sql';
const refunds = 'create-refunds.sql';
const mapper = 'refund-mapper.sql';
const api = 'refund-api.ts';
const transaction = '按订单查询退款';
const graphTitle = '订单表到退款接口的依赖';
const sections = ['数据架构总览', '核心实体与表结构', 'SQL 读写与映射热点', '事务边界与迁移风险'];
const ordersSchema = 'CREATE TABLE orders (id INTEGER PRIMARY KEY, cents INTEGER NOT NULL';
const sourceFiles = {
  [orders]: `${ordersSchema});\n`,
  [refunds]: 'CREATE TABLE refunds (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id));\n',
  [mapper]: 'SELECT id FROM refunds WHERE order_id = ?;\n',
  [api]:
    "import { readFileSync } from 'node:fs';\nexport const sql = readFileSync(new URL('./refund-mapper.sql', import.meta.url), 'utf8');\n",
};

function module(title: string, path: string, line = 1): DesignBlock {
  return {
    type: 'submodule',
    id: path,
    title,
    summary: title,
    files: [path],
    behaviors: [
      {
        title: '仓库证据',
        markdown: title,
        evidence: [{ evidenceClass: DesignEvidenceClass.Static, relPath: path, lineStart: line, lineEnd: line }],
      },
    ],
  };
}

const dependency: DesignDiagram = {
  id: 'refund-data-dependency',
  kind: DesignDiagramKind.Architecture,
  title: graphTitle,
  nodes: [
    { id: 'orders', label: 'orders 表', relPath: orders },
    { id: 'refunds', label: 'refunds 表', relPath: refunds },
    { id: 'mapper', label: '退款 Mapper SQL', relPath: mapper },
    { id: 'api', label: '退款查询接口', relPath: api },
  ],
  edges: [
    {
      id: 'foreign-key',
      from: 'refunds',
      to: 'orders',
      kind: 'references',
      label: '外键引用订单',
      evidenceClass: DesignEvidenceClass.Static,
      evidencePath: refunds,
      lineStart: 1,
      lineEnd: 1,
    },
    {
      id: 'select-refund',
      from: 'mapper',
      to: 'refunds',
      kind: 'reads',
      label: '查询退款表',
      evidenceClass: DesignEvidenceClass.Static,
      evidencePath: mapper,
      lineStart: 1,
      lineEnd: 1,
    },
    {
      id: 'load-mapper',
      from: 'api',
      to: 'mapper',
      kind: 'calls',
      label: '接口加载退款 SQL',
      evidenceClass: DesignEvidenceClass.Static,
      evidencePath: api,
      lineStart: 2,
      lineEnd: 2,
    },
  ],
};

const transactionGraph: DesignDiagram = {
  id: 'refund-query-transaction',
  kind: DesignDiagramKind.BusinessFlow,
  title: transaction,
  nodes: [{ id: 'query-refund', label: '按订单加载退款查询', relPath: api }],
  edges: [],
};

const chapters: { blocks: DesignBlock[]; diagrams: DesignDiagram[]; paths: string[] }[] = [
  {
    blocks: [{ type: 'markdown', markdown: '订单与退款通过外键关联，查询 SQL 由接口加载。' }],
    diagrams: [],
    paths: [],
  },
  { blocks: [module('orders 表', orders), module('refunds 表', refunds)], diagrams: [], paths: [orders, refunds] },
  {
    blocks: [
      module('退款 Mapper SQL', mapper),
      module('退款查询接口', api, 2),
      { type: 'diagram_ref', diagramId: dependency.id },
    ],
    diagrams: [dependency],
    paths: [mapper, api],
  },
  {
    blocks: [
      {
        type: 'transaction',
        title: transaction,
        code: 'REFUND_LOOKUP',
        diagramId: transactionGraph.id,
        evidence: [{ evidenceClass: DesignEvidenceClass.Static, relPath: api, lineStart: 2, lineEnd: 2 }],
      },
    ],
    diagrams: [transactionGraph],
    paths: [],
  },
];

async function readDesign(request: APIRequestContext, id: string) {
  const response = await request.get(`${API_BASE}/designs/${id}`, { headers: AUTH });
  await expect(response).toBeOK();
  return getDesignOp.output.parse(await response.json());
}

async function queueChapters(
  request: APIRequestContext,
  project: E2EProject,
  design: Awaited<ReturnType<typeof readDesign>>,
) {
  for (const [index, chapter] of chapters.entries()) {
    const section = design.sections[index];
    if (section === undefined) throw new Error('Missing data explorer section');
    const steps: FakeStep[] = [
      {
        type: 'callTool',
        name: McpToolName.SubmitDesignSection,
        args: {
          sectionId: section.id,
          summary: section.title,
          blocks: chapter.blocks,
          files: chapter.paths.map((relPath) => ({ relPath, responsibility: relPath, symbols: [] })),
          diagrams: chapter.diagrams,
        },
      },
    ];
    await expect(
      await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
        headers: AUTH,
        data: { match: { directory: project.repoPath, agent: OPENCODE_AGENT_NAME.designer }, steps },
      }),
    ).toBeOK();
  }
}

test('无数据库连接时从迁移和 SQL 生成数据设计，审查追溯表、SQL、接口和交易', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  for (const [path, source] of Object.entries(sourceFiles)) writeFileSync(join(project.repoPath, path), source);
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-m', 'Add order and refund SQL');
  const from = git(project.repoPath, 'rev-parse', 'HEAD');
  const projectResponse = await request.get(`${API_BASE}/projects/${project.id}`, { headers: AUTH });
  await expect(projectResponse).toBeOK();
  expect(getProjectOp.output.parse(await projectResponse.json()).dbConnectionIds).toEqual([]);

  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': ThemeId.Codex });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/designs/new?projectId=${project.id}`);
  const template = page.getByRole('radio', { name: /^数据模型与 SQL 链路探索/ });
  await template.check();
  await expect(template).toBeChecked();
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]+(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '分析大纲' })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (id === undefined) throw new Error('Missing project design ID');
  const draft = await readDesign(request, id);
  expect(draft.templateKey).toBe(DATA_EXPLORER_KEY);
  expect(draft.sections.map(({ title }) => title)).toEqual(sections);
  for (const name of sections) await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Codex);
  await page.screenshot({ path: info.outputPath('data-explorer-outline-light.png'), animations: 'disabled' });

  await queueChapters(request, project, draft);
  await page.getByRole('button', { name: '确认大纲，开始生成' }).click();
  await expect.poll(async () => (await readDesign(request, id)).status).toBe(DesignStatus.Ready);
  const ready = await readDesign(request, id);
  expect(ready.sourceSnapshot).toMatchObject({ commitSha: from, dirty: false });
  expect(ready.diagrams.find(({ title }) => title === graphTitle)?.edges).toMatchObject(dependency.edges);
  await page.getByRole('searchbox', { name: '搜索设计内容' }).fill(graphTitle);
  await page.getByRole('button', { name: new RegExp(graphTitle) }).click();
  const reader = page.getByRole('region', { name: '设计正文' });
  await expect(reader.getByRole('region', { name: graphTitle, exact: true })).toBeVisible();
  await reader.getByText('文本边列表', { exact: true }).click();
  await expect(reader.getByText('接口加载退款 SQL', { exact: false }).last()).toBeVisible();
  await patchSettings(request, { 'ui.theme': ThemeId.Default });
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Default);
  await page.screenshot({ path: info.outputPath('data-explorer-dependencies-dark.png'), animations: 'disabled' });

  writeFileSync(join(project.repoPath, orders), `${ordersSchema}, currency CHAR(3));\n`);
  git(project.repoPath, 'add', orders);
  git(project.repoPath, 'commit', '-m', 'Add order currency');
  const to = git(project.repoPath, 'rev-parse', 'HEAD');
  await queueCodeReviewerTurn(request, project, [
    { type: 'callTool', name: McpToolName.SubmitFindings, args: { summary: '已读取审查范围。', findings: [] } },
  ]);
  const started = await request.post(`${API_BASE}/projects/${project.id}/git/reviews`, {
    headers: AUTH,
    data: { target: { kind: GitReviewTarget.Compare, from, to } },
  });
  await expect(started).toBeOK();
  const review = gitReviewSchema.parse(await started.json());
  expect(review).toMatchObject({ designId: id, designSnapshotSha: from, designMatch: DesignKnowledgeMatch.Reference });
  expect(review.files.map(({ path }) => path)).toEqual([orders]);
  await page.goto(`/git/${project.id}?view=review&review=${review.id}`);
  const comparison = page.getByRole('region', { name: '双版本端点对比', exact: true });
  await expect(comparison).toContainText('已读取审查范围。');

  const transcript = await request.get(`${API_BASE}/attempts/${review.attemptId}/transcript`, { headers: AUTH });
  await expect(transcript).toBeOK();
  const firstPrompt = transcriptPageSchema
    .parse(await transcript.json())
    .entries.find(({ kind }) => kind === TranscriptEntryKind.UserMessage)?.data.text;
  if (firstPrompt === undefined) throw new Error('Missing reviewer prompt');
  const candidates = firstPrompt
    .split('\n')
    .filter((line) => line.startsWith('{"targetKind"'))
    .map((line) => JSON.parse(line));
  expect(candidates).toEqual(
    expect.arrayContaining(
      [
        { title: 'orders 表', targetKind: GitImpactTargetKind.Submodule, distance: 0 },
        { title: 'refunds 表', targetKind: GitImpactTargetKind.Submodule, distance: 1 },
        { title: '退款 Mapper SQL', targetKind: GitImpactTargetKind.Submodule, distance: 2 },
        { title: '退款查询接口', targetKind: GitImpactTargetKind.Submodule, distance: 3 },
        { title: transaction, targetKind: GitImpactTargetKind.Transaction, distance: 3 },
      ].map(({ title, targetKind, distance }) =>
        expect.objectContaining({
          title,
          targetKind,
          distance,
          sourcePath: orders,
          classification: distance === 0 ? GitImpactClassification.Direct : GitImpactClassification.Indirect,
        }),
      ),
    ),
  );
});
