import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DesignDiagramKind,
  type DesignDTO,
  DesignEvidenceClass,
  DesignSectionKind,
  DesignStatus,
  type InboxItemDTO,
  InboxKind,
  listDesignsOp,
  listProjectsOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  THEME_IDS,
  ThemeId,
} from '@aw/shared';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, type FakeStep, git, patchSettings } from './helpers.ts';
import { inspectPage, WALKTHROUGH_DIR } from './walkthrough.ts';

const IMPLEMENTATION = 'src/refunds.ts';
const FILE_NAME = 'refunds.ts';
const SYMBOL = 'refunds.buildRefund';
const SYMBOL_ID = 'build-refund';
const REPOSITORY_TITLE = '退款工作流设计';
const OVERVIEW = '设计总览';
const CALLS = '调用关系';
const FLOW = '退款流程';
const OMIT = '实验路径';
const GRAPH_TITLES = ['退款系统架构', '退款方法调用', '退款业务流程'] as const;
const GATES = ['rg -n buildRefund src/refunds.ts', 'rg -n submitRefund src/refunds.ts'] as const;
const OUTLINE = [
  { kind: DesignSectionKind.Overview, title: OVERVIEW, scopePaths: [] },
  { kind: DesignSectionKind.Module, title: CALLS, scopePaths: ['src'] },
  { kind: DesignSectionKind.Flow, title: FLOW, scopePaths: ['src'] },
  { kind: DesignSectionKind.Custom, title: OMIT, scopePaths: [] },
];

type ChapterIds = { overview: string; calls: string; flow: string };

const tool = (name: McpToolName, args: Record<string, unknown>): FakeStep => ({ type: 'callTool', name, args });
const gate = (pattern: string): FakeStep => ({ type: 'permission', permission: 'bash', patterns: [pattern] });

function pendingGraph(kind: DesignDiagramKind, title: string) {
  return {
    id: kind,
    kind,
    title,
    nodes: [
      { id: 'entry', label: '退款入口', targetKind: 'file', relPath: IMPLEMENTATION },
      { id: 'builder', label: '构建退款单', targetKind: 'symbol', targetId: SYMBOL_ID, relPath: IMPLEMENTATION },
    ],
    edges: [
      {
        id: 'build',
        from: 'entry',
        to: 'builder',
        kind: 'calls',
        label: '调用退款构建',
        evidenceClass: DesignEvidenceClass.Static,
        evidencePath: IMPLEMENTATION,
        lineStart: 1,
        lineEnd: 3,
      },
    ],
  };
}

function chapter(
  sectionId: string,
  summary: string,
  kind: DesignDiagramKind,
  diagramTitle: string,
  includeFile = false,
) {
  return tool(McpToolName.SubmitDesignSection, {
    sectionId,
    summary,
    blocks: [
      { type: 'markdown', markdown: summary },
      ...Array.from({ length: 9 }, (_, index) => ({
        type: 'markdown',
        title: `退款约束 ${index + 1}`,
        markdown: '请求入口负责检查订单状态。退款记录只在创建单号后进入处理流程，便于追踪执行结果。',
      })),
      { type: 'diagram_ref', diagramId: kind },
    ],
    files: includeFile
      ? [
          {
            relPath: IMPLEMENTATION,
            responsibility: '建立退款请求并检查必要字段。',
            symbols: [
              {
                id: SYMBOL_ID,
                name: 'buildRefund',
                kind: 'function',
                qualifiedName: SYMBOL,
                signature: 'buildRefund(order: string): Refund',
                lineStart: 1,
                lineEnd: 3,
                summary: '构建一份退款单。',
                callers: ['submitRefund'],
              },
            ],
          },
        ]
      : [],
    diagrams: [pendingGraph(kind, diagramTitle)],
  });
}

async function queueChapters(request: APIRequestContext, project: E2EProject, ids: ChapterIds, pause = false) {
  await queueDesign(request, project, [
    chapter(ids.overview, '总览已提交', DesignDiagramKind.Architecture, GRAPH_TITLES[0], true),
  ]);
  await queueDesign(request, project, [
    ...(pause ? [gate(GATES[0])] : []),
    chapter(ids.calls, '调用关系已提交', DesignDiagramKind.CallGraph, GRAPH_TITLES[1]),
  ]);
  await queueDesign(request, project, [
    ...(pause ? [gate(GATES[1])] : []),
    chapter(ids.flow, '流程内容已提交', DesignDiagramKind.BusinessFlow, GRAPH_TITLES[2]),
  ]);
}

async function fixtureProject(request: APIRequestContext) {
  const project = await createProject(request, null);
  mkdirSync(join(project.repoPath, 'src'));
  writeFileSync(
    join(project.repoPath, IMPLEMENTATION),
    [
      'export function buildRefund(order: string) {',
      '  return { order, status: "pending" };',
      '}',
      'export function submitRefund(order: string) {',
      '  return buildRefund(order);',
      '}',
    ].join('\n'),
  );
  writeFileSync(join(project.repoPath, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-m', 'Add the refund fixture');
  const renamed = await request.patch(`${API_BASE}/projects/${project.id}`, {
    headers: AUTH,
    data: { name: '退款服务' },
  });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  return project;
}

async function queueDesign(request: APIRequestContext, project: E2EProject, steps: FakeStep[]) {
  const result = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { directory: project.repoPath, agent: OPENCODE_AGENT_NAME.designer }, steps },
  });
  expect(result.ok(), await result.text()).toBe(true);
}

async function design(request: APIRequestContext, id: string): Promise<DesignDTO> {
  const result = await request.get(`${API_BASE}/designs/${id}`, { headers: AUTH });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}

function designId(page: Page) {
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (id === undefined || id === '' || id === 'new') throw new Error('设计尚未创建');
  return id;
}

function chapterIds({ sections }: DesignDTO): ChapterIds {
  const idOf = (title: string) => {
    const found = sections.find((section) => section.title === title);
    if (found === undefined) throw new Error(`大纲缺少章节 ${title}`);
    return found.id;
  };
  return { overview: idOf(OVERVIEW), calls: idOf(CALLS), flow: idOf(FLOW) };
}

/** 释放假模型的检查点，让测试可以停留在阅读区观察下一章出现。 */
async function releaseGate(request: APIRequestContext, pattern: string) {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(`${API_BASE}/inbox?status=open`, { headers: AUTH });
      expect(response.ok()).toBe(true);
      const { items }: { items: InboxItemDTO[] } = await response.json();
      id = items.find((item) => item.kind === InboxKind.Permission && item.payload.patterns.includes(pattern))?.id;
      return id;
    })
    .toBeDefined();
  if (id === undefined) throw new Error(`未收到假模型的检查点 ${pattern}`);
  const resolved = await request.post(`${API_BASE}/inbox/${id}/resolve`, {
    headers: AUTH,
    data: { response: { decision: 'once' } },
  });
  expect(resolved.ok(), await resolved.text()).toBe(true);
}

async function verifyOffline(browser: Browser, target: string) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const external: string[] = [];
  try {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:')) return route.continue();
      external.push(url);
      return route.abort();
    });
    const offline = await context.newPage();
    const failures: string[] = [];
    offline.on('pageerror', (error) => failures.push(error.message));
    await offline.goto(pathToFileURL(join(target, 'index.html')).href);
    await expect(offline.getByRole('heading', { name: '总体架构', exact: true })).toBeVisible();
    const nav = offline.getByRole('navigation', { name: '章节目录' });
    await expect(nav.getByRole('link', { name: OMIT, exact: true })).toHaveCount(0);
    const article = offline.getByRole('main');
    const search = offline.getByRole('searchbox', { name: '搜索章节、文件和符号' });
    for (const [index, name] of GRAPH_TITLES.entries()) {
      await search.fill(name);
      await offline.locator('.search-results').getByRole('link', { name, exact: true }).click();
      await expect(article.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(article.getByRole('group', { name, exact: true })).toBeVisible();
      await expect(article.getByText(['架构图', '调用图', '业务流程图'][index] ?? '')).toBeVisible();
      await article.getByText('文本边列表（1）').click();
      await expect(article.getByRole('listitem')).toContainText('调用退款构建');
      await expect(article.getByRole('listitem')).toContainText('静态确认');
    }
    await article
      .getByRole('group', { name: GRAPH_TITLES[2], exact: true })
      .getByRole('link', { name: '构建退款单', exact: true })
      .click();
    await expect(article.getByRole('heading', { name: IMPLEMENTATION, exact: true })).toBeVisible();
    await expect(article.locator('.symbol.highlight')).toContainText(SYMBOL);

    await search.fill('退款流程');
    await offline.locator('.search-results').getByRole('link', { name: FLOW, exact: true }).click();
    await expect(article.getByRole('heading', { name: FLOW, exact: true })).toBeVisible();
    await search.fill('BUILDREFUND');
    await offline.locator('.search-results').getByRole('link', { name: SYMBOL, exact: true }).click();
    await expect(article.locator('.symbol.highlight')).toContainText('构建一份退款单。');
    expect(external).toEqual([]);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
  }
}

test('项目设计从项目页新建，逐章跟随与自由阅读，搜索下钻并直接打开离线站点', async ({ page, request, browser }) => {
  const project = await fixtureProject(request);
  await patchSettings(request, { 'ui.theme': ThemeId.Codex, 'ui.mode': 'simple' });
  await page.goto(`/projects/${project.id}`);
  const nav = page.getByRole('navigation', { name: 'Agent Workflow' });
  await expect(nav.getByRole('link', { name: '项目设计', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '查看项目设计', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: '项目设计', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '项目设计', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '专业模式' }).click();
  await expect(nav.getByRole('link', { name: '项目设计', exact: true })).toBeVisible();

  await page.goto(`/projects/${project.id}`);
  await page.getByRole('link', { name: '新建项目设计', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: '新建项目设计' })).toBeVisible();
  await expect(page.getByLabel('目标项目')).toHaveValue(project.id);
  await expect(page.getByText(/识别的技术栈.*React/)).toBeVisible();
  const template = page.getByRole('group', { name: '分析模板' });
  await expect(template.getByRole('radio', { name: /^交易链路探索/ })).toBeVisible();
  await expect(template.getByRole('radio', { name: /^架构探索/ })).toBeChecked();
  await expect(page.getByLabel('主题', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]+(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '分析大纲' })).toBeVisible();
  const id = designId(page);
  expect((await design(request, id)).templateKey).toBe('general');

  await queueDesign(request, project, [
    tool(McpToolName.SubmitDesignOutline, { title: REPOSITORY_TITLE, sections: OUTLINE }),
  ]);
  await page.getByRole('button', { name: '让 AI 优化大纲' }).click();
  await page.getByRole('dialog', { name: '让 AI 优化大纲' }).getByRole('button', { name: '让 AI 优化大纲' }).click();
  const unchecked = page.getByRole('checkbox', { name: OMIT, exact: true });
  await expect(unchecked).toBeChecked();
  await unchecked.click();
  await expect(unchecked).not.toBeChecked();
  await expect
    .poll(async () => (await design(request, id)).sections.find(({ title }) => title === OMIT)?.selected)
    .toBe(false);
  await page.reload();
  await expect(unchecked).not.toBeChecked();
  const ids = chapterIds(await design(request, id));

  await queueChapters(request, project, ids, true);
  await page.getByRole('button', { name: '确认大纲，开始生成' }).click();
  const directory = page.getByRole('navigation', { name: '章节目录' });
  await expect(page.getByText('1 / 3 章节', { exact: true })).toBeVisible();
  await expect(directory.getByText(OMIT, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: OVERVIEW, exact: true })).toBeVisible();
  await expect(page.getByText('总览已提交', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '自由阅读', exact: true }).click();
  const reader = page.getByRole('article').filter({ has: page.getByRole('navigation', { name: '面包屑' }) });
  const scrollArea = reader.locator('..');
  await scrollArea.hover();
  await page.mouse.wheel(0, 310);
  await expect.poll(() => scrollArea.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  const scrollBefore = await scrollArea.evaluate((element) => element.scrollTop);
  await releaseGate(request, GATES[0]);
  await expect(page.getByText('2 / 3 章节', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: OVERVIEW, exact: true })).toBeAttached();
  await expect.poll(() => scrollArea.evaluate((element) => element.scrollTop)).toBe(scrollBefore);

  await page.getByRole('button', { name: '跟随最新', exact: true }).click();
  await releaseGate(request, GATES[1]);
  await expect(page.getByText('3 / 3 章节', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: FLOW, exact: true })).toBeInViewport();

  const search = page.getByRole('searchbox', { name: '搜索设计内容' });
  await search.fill('设计总览');
  await page
    .getByRole('button', { name: /设计总览/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: OVERVIEW, exact: true })).toBeInViewport();
  await expect(reader.and(page.locator('[data-highlight]'))).toContainText(OVERVIEW);
  await search.fill('BUILDREFUND');
  await page.getByRole('button', { name: new RegExp(SYMBOL) }).click();
  await expect(page.getByRole('heading', { name: FILE_NAME, exact: true })).toBeVisible();
  await expect(reader.locator('section[data-highlight]')).toContainText(SYMBOL);

  await search.clear();
  await directory.getByRole('button', { name: GRAPH_TITLES[0], exact: true }).click();
  await expect(page.getByRole('heading', { name: GRAPH_TITLES[0], exact: true })).toBeVisible();
  await page.getByText('文本边列表', { exact: false }).click();
  await expect(page.getByText('调用退款构建', { exact: false }).last()).toBeVisible();
  const graph = reader.getByRole('region', { name: GRAPH_TITLES[0], exact: true });
  await graph.getByRole('button', { name: '退款入口', exact: true }).click();
  await expect(page.getByRole('heading', { name: FILE_NAME, exact: true })).toBeVisible();
  await directory.getByRole('button', { name: GRAPH_TITLES[0], exact: true }).click();
  await graph.getByRole('button', { name: '构建退款单', exact: true }).click();
  await expect(reader.locator('section[data-highlight]')).toContainText('构建一份退款单。');

  await directory.getByRole('button', { name: OVERVIEW, exact: false }).first().click();
  await queueDesign(request, project, [
    chapter(ids.overview, '总览只重写这一章', DesignDiagramKind.Architecture, GRAPH_TITLES[0], true),
  ]);
  await page.getByRole('button', { name: '让 AI 重写' }).click();
  const revise = page.getByRole('dialog', { name: '让 AI 重写' });
  await revise.getByLabel('重写要求').fill('只补充退款入口说明');
  await revise.getByRole('button', { name: '开始重写' }).click();
  await expect(reader.getByText('总览只重写这一章', { exact: true }).first()).toBeVisible();
  expect((await design(request, id)).sections.find(({ id }) => id === ids.calls)?.summary).toBe('调用关系已提交');
  await page.getByRole('button', { name: '恢复上一版' }).click();
  await page.getByRole('dialog', { name: '恢复上一版' }).getByRole('button', { name: '恢复上一版' }).click();
  await expect(reader.getByText('总览已提交', { exact: true }).first()).toBeVisible();

  const target = join(mkdtempSync(join(tmpdir(), 'aw-design-site-')), '退款 设计站点');
  await page.getByRole('button', { name: '导出离线 HTML' }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出离线 HTML' });
  await exportDialog.getByLabel('导出目录').fill(target);
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByText(/离线站点已导出到/)).toBeVisible();
  await verifyOffline(browser, target);
});

async function themeFixture(request: APIRequestContext) {
  const project = await fixtureProject(request);
  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, theme: ThemeId.Codex, aiReviewEnabled: false },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id }: DesignDTO = await created.json();
  const outline = await request.put(`${API_BASE}/designs/${id}/outline`, {
    headers: AUTH,
    data: { sections: OUTLINE.map((section) => ({ ...section, selected: section.title !== OMIT })) },
  });
  expect(outline.ok(), await outline.text()).toBe(true);
  const ids = chapterIds(await outline.json());
  await queueChapters(request, project, ids);
  const generated = await request.post(`${API_BASE}/designs/${id}/generate`, { headers: AUTH, data: {} });
  expect(generated.ok(), await generated.text()).toBe(true);
  await expect.poll(async () => (await design(request, id)).status).toBe(DesignStatus.Ready);
  return id;
}

test.describe('项目设计阅读页主题走查', () => {
  let id: string;
  test.beforeAll(async ({ request }) => {
    id = await themeFixture(request);
  });
  for (const theme of THEME_IDS) {
    test(`${theme} 的阅读、图谱与局部滚动无溢出`, async ({ page, request }) => {
      await patchSettings(request, { 'ui.theme': theme, 'ui.mode': 'pro' });
      await page.setViewportSize({ width: 1440, height: 960 });
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(`/designs/${id}`);
      const directory = page.getByRole('navigation', { name: '章节目录' });
      await directory.getByRole('button', { name: /设计总览/ }).click();
      await expect(page.getByRole('heading', { name: OVERVIEW, exact: true })).toBeVisible();
      const preferences = page.locator('summary[aria-label="阅读与复审设置"]');
      await preferences.click();
      await expect(preferences.locator('..').getByLabel('主题', { exact: true })).toHaveCount(0);
      await preferences.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const chapterReport = await inspectPage(page);
      expect(chapterReport.contrast).toEqual([]);
      expect(chapterReport.overflow).toEqual([]);
      await directory.getByText('文件与符号 · 2', { exact: true }).click();
      await directory.getByRole('button', { name: GRAPH_TITLES[0], exact: true }).click();
      await expect(page.getByRole('region', { name: GRAPH_TITLES[0], exact: true })).toBeVisible();
      const graphReport = await inspectPage(page);
      expect(graphReport.contrast).toEqual([]);
      expect(graphReport.overflow).toEqual([]);
      expect(failures).toEqual([]);
      if (theme === ThemeId.Default || theme === ThemeId.Codex) {
        const path = join(WALKTHROUGH_DIR, 'project-design', `${theme}.png`);
        mkdirSync(join(WALKTHROUGH_DIR, 'project-design'), { recursive: true });
        await page.screenshot({ path, animations: 'disabled' });
      }
    });
  }
});

test('工作台原位改名、架构阅读顺序与图边交互', async ({ page, request }) => {
  const id = await themeFixture(request);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/designs/${id}`);

  const splitter = page.getByRole('separator', { name: '调整目录宽度' });
  await expect(splitter).toHaveAttribute('aria-valuenow', '245');
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '261');
  await page.getByRole('button', { name: '收起目录' }).click();
  await expect(splitter).toHaveCount(0);
  await page.getByRole('button', { name: '展开目录' }).click();
  await expect(splitter).toHaveAttribute('aria-valuenow', '261');
  const splitterBounds = await splitter.boundingBox();
  if (splitterBounds === null) throw new Error('Outline splitter is not visible');
  const x = Math.round(splitterBounds.x + splitterBounds.width / 2);
  const y = Math.round(splitterBounds.y + splitterBounds.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y);
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', '285');

  await page.getByRole('button', { name: '修改设计标题' }).click();
  const title = page.getByRole('textbox', { name: '修改设计标题' });
  await title.fill('退款 · 项目设计');
  await title.press('Enter');
  await expect(page.getByRole('heading', { name: '退款 · 项目设计', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '退款 · 项目设计', exact: true, level: 2 })).toBeVisible();
  expect((await design(request, id)).title).toBe('退款 · 项目设计');

  const preferences = page.locator('summary[aria-label="阅读与复审设置"]');
  await preferences.click();
  await preferences
    .locator('..')
    .getByLabel(/^阅读风格/)
    .selectOption('arch');
  await preferences.click();
  const directory = page.getByRole('navigation', { name: '章节目录' });
  await directory.getByRole('button', { name: OVERVIEW, exact: true }).click();
  const reader = page.getByRole('region', { name: '设计正文' });
  const graph = reader.getByRole('region', { name: GRAPH_TITLES[0], exact: true });
  await expect(graph).toHaveCount(1);
  await expect(reader.getByRole('heading', { name: '项目模块' })).toBeVisible();
  const headings = await reader.getByRole('heading').allTextContents();
  expect(headings.indexOf(GRAPH_TITLES[0])).toBeLessThan(headings.indexOf('退款约束 1'));
  expect(headings.indexOf('项目模块')).toBeLessThan(headings.indexOf('退款约束 1'));

  // Chromium 的无头模式隐藏滚动条，从滚动区触发与拖动滚动条相同的 scroll 路径。
  await page.getByRole('button', { name: '跟随最新' }).click();
  await expect(reader.getByRole('heading', { name: FLOW, exact: true })).toBeVisible();
  await reader.evaluate((pane) => {
    pane.scrollTop = 140;
  });
  await expect(page.getByRole('button', { name: '自由阅读' })).toHaveAttribute('aria-pressed', 'true');
  expect(await reader.evaluate((pane) => pane.scrollTop)).toBe(140);

  await directory.getByRole('button', { name: OVERVIEW, exact: true }).click();
  await graph.scrollIntoViewIfNeeded();
  const edge = graph.locator('.react-flow__edge-path');
  await expect(edge).toHaveCount(1);
  const edgePoint = () =>
    edge.evaluate((element) => {
      if (!(element instanceof SVGPathElement)) throw new Error('Unexpected graph edge');
      const matrix = element.getScreenCTM();
      if (matrix === null) throw new Error('The graph edge is not laid out');
      const midpoint = element.getPointAtLength(element.getTotalLength() / 2);
      const { x, y } = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(matrix);
      return { x, y, hittable: Boolean(document.elementFromPoint(x, y)?.closest('.react-flow__edge')) };
    });
  const evidence = graph.getByRole('complementary', { name: '关系证据' });
  await expect.poll(async () => (await edgePoint()).hittable).toBe(true);
  const hoverAt = await edgePoint();
  await page.mouse.move(hoverAt.x, hoverAt.y);
  await expect(evidence.getByText('静态确认')).toBeVisible();
  const clickAt = await edgePoint();
  await page.mouse.click(clickAt.x, clickAt.y);
  await expect(evidence).toHaveAttribute('data-pinned', 'true');
  await page.mouse.move(1, 1);
  await expect(evidence.getByText('调用退款构建')).toBeVisible();
  await expect(evidence.getByText(`${IMPLEMENTATION}:1`)).toBeVisible();
  await evidence.getByRole('button', { name: '关闭' }).click();
  await expect(evidence).toHaveCount(0);

  await preferences.click();
  await preferences.locator('..').getByRole('button', { name: '删除设计', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除设计' });
  await confirm.getByRole('button', { name: '取消' }).click();
  expect((await design(request, id)).title).toBe('退款 · 项目设计');
  await preferences.locator('..').getByRole('button', { name: '删除设计', exact: true }).click();
  await confirm.getByRole('button', { name: '删除设计', exact: true }).click();
  await expect(page).toHaveURL(/\/designs$/);
  const deleted = await request.get(`${API_BASE}/designs/${id}`, { headers: AUTH });
  expect(deleted.status()).toBe(404);
});

test('草稿可以取消删除，所属项目删除后仍能确认删除', async ({ page, request }) => {
  const project = await fixtureProject(request);
  await page.goto(`/designs/new?projectId=${project.id}`);
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  await expect(page.getByRole('heading', { name: '分析大纲' })).toBeVisible();
  const id = designId(page);
  expect(await design(request, id)).toMatchObject({ outlineConfirmedAt: null, runs: [] });

  const remove = page.getByRole('button', { name: '删除设计', exact: true });
  const confirmation = page.getByRole('dialog', { name: '删除设计' });
  await remove.click();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(await design(request, id)).toMatchObject({ projectId: project.id, runs: [] });

  const projectDeletion = await request.delete(`${API_BASE}/projects/${project.id}`, { headers: AUTH });
  expect(projectDeletion.status(), await projectDeletion.text()).toBe(204);
  await page.goto('/designs');
  await expect(page).toHaveURL(/\/designs$/);
  const retained = page.locator(`a[href="/designs/${id}"]`);
  await expect(retained).toHaveAccessibleName(/退款服务 项目设计.*项目已删除/);
  await retained.click();
  await expect(page.getByText('项目已删除', { exact: true })).toBeVisible();
  await expect(remove).toBeEnabled();
  await remove.click();
  const removalResponse = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url() === `${API_BASE}/designs/${id}`,
  );
  await confirmation.getByRole('button', { name: '删除设计', exact: true }).click();
  expect((await removalResponse).status()).toBe(204);
  const deleted = await request.get(`${API_BASE}/designs/${id}`, { headers: AUTH });
  expect(deleted.status()).toBe(404);
  const [projects, designs] = await Promise.all([
    request.get(`${API_BASE}/projects`, { headers: AUTH }),
    request.get(`${API_BASE}/designs?limit=1`, { headers: AUTH }),
  ]);
  const emptyWorkspace =
    listProjectsOp.output.parse(await projects.json()).items.length === 0 &&
    listDesignsOp.output.parse(await designs.json()).items.length === 0;
  await expect(page).toHaveURL(emptyWorkspace ? /\/onboarding$/ : /\/designs$/);
});

test('架构探索模板区在选项目时保持尺寸，自定义模板可从库选用', async ({ page, request }) => {
  const project = await fixtureProject(request);
  await page.goto('/designs/new');
  const picker = page.getByRole('group', { name: '分析模板' });
  await expect(picker.getByRole('radio', { name: /^架构探索/ })).toBeChecked();
  const before = await picker.boundingBox();
  await page.getByLabel('目标项目').selectOption(project.id);
  await expect(page.getByText(/识别的技术栈.*React/)).toBeVisible();
  const after = await picker.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(after?.width).toBe(before?.width);
  await expect(page.getByLabel('主题', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '查看模板库' }).click();
  const architecture = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '架构探索' }) });
  await expect(architecture.getByText('总体架构', { exact: true })).toBeVisible();
  await architecture.getByText('展开侧重').click();
  await expect(architecture.getByText(/区分组成关系和带方向的依赖关系/)).toBeVisible();
  await architecture.getByRole('button', { name: '复制为自定义模板' }).click();
  const editor = page.getByRole('dialog', { name: '复制为自定义模板' });
  await editor.getByLabel('模板名称').fill('研发结构简报');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  const custom = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '研发结构简报' }) });
  await custom.getByRole('link', { name: '使用此模板新建' }).click();
  await expect(picker.getByRole('radio', { name: /^研发结构简报/ })).toBeChecked();
  await expect(picker.getByRole('radio', { name: /^交易链路探索/ })).toBeVisible();
});

test('架构探索从项目首页逐级进入子模块、文件和可校验的完整源码', async ({ page, request }) => {
  const project = await fixtureProject(request);
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': ThemeId.Codex });
  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, aiReviewEnabled: false },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id }: DesignDTO = await created.json();
  const outline = await request.put(`${API_BASE}/designs/${id}/outline`, {
    headers: AUTH,
    data: { sections: [{ kind: DesignSectionKind.Module, title: '退款处理', scopePaths: ['src'], selected: true }] },
  });
  expect(outline.ok(), await outline.text()).toBe(true);
  const { sections }: DesignDTO = await outline.json();
  const module = sections[0];
  if (module === undefined) throw new Error('Expected module draft');
  const base = chapter(module.id, '处理退款请求。', DesignDiagramKind.Architecture, '模块架构', true);
  if (base.type !== 'callTool') throw new Error('Expected submission');
  const submodule = {
    type: 'submodule',
    id: 'refund-command',
    title: '退款指令',
    summary: '实现退款入口。',
    files: [IMPLEMENTATION],
    behaviors: [
      {
        title: '构建退款单',
        markdown: '初始化待处理的退款请求。',
        evidence: [{ evidenceClass: DesignEvidenceClass.Static, relPath: IMPLEMENTATION, lineStart: 1, lineEnd: 3 }],
      },
    ],
  };
  await queueDesign(request, project, [
    {
      ...base,
      args: { ...base.args, blocks: [submodule, { type: 'markdown', title: '消息处理', markdown: '记录实际请求。' }] },
    },
  ]);
  const generated = await request.post(`${API_BASE}/designs/${id}/generate`, { headers: AUTH, data: {} });
  expect(generated.ok(), await generated.text()).toBe(true);
  await expect.poll(async () => (await design(request, id)).status).toBe(DesignStatus.Ready);

  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/designs/${id}`);
  const reader = page.getByRole('region', { name: '设计正文' });
  const crumbs = reader.getByRole('navigation', { name: '面包屑' });
  await expect(reader.getByRole('heading', { name: '项目大纲' })).toBeVisible();
  await expect(reader.getByText('项目介绍将在总览章节提交后显示', { exact: false })).toHaveCount(0);
  const shots = process.env.AW_ARCHITECTURE_SCREENSHOTS;
  if (shots !== undefined) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, 'overview.png'), animations: 'disabled' });
  }
  await reader
    .getByRole('region', { name: '总体架构', exact: true })
    .getByRole('button', { name: '退款处理' })
    .press('Enter');
  await expect(reader.getByRole('heading', { name: '退款处理' })).toBeVisible();
  const internal = reader.getByRole('region', { name: '内部架构', exact: true });
  await internal.getByRole('button', { name: '退款指令' }).click();
  await expect(reader.getByRole('heading', { name: '退款指令' })).toBeVisible();
  await expect(reader.getByText('初始化待处理的退款请求。')).toBeVisible();
  await internal.getByRole('button', { name: FILE_NAME }).click();
  await expect(reader.getByRole('heading', { name: FILE_NAME, exact: true })).toBeVisible();
  await expect(crumbs.getByRole('button', { name: '退款指令' })).toBeVisible();
  const source = reader.getByLabel('完整源码');
  await expect(source).toContainText('export function submitRefund');
  await expect(source).toHaveCSS('background-color', 'rgb(23, 34, 53)');
  if (shots !== undefined) await page.screenshot({ path: join(shots, 'file.png'), animations: 'disabled' });
  await reader
    .getByRole('region', { name: '文件内部结构', exact: true })
    .getByRole('button', { name: 'buildRefund' })
    .click();
  await expect(source.locator('[data-current-line]')).toHaveCount(3);
  await expect(source.locator('[data-current-line]').first()).toContainText('export function buildRefund');
  await crumbs.getByRole('button', { name: '退款指令' }).click();
  await expect(reader.getByRole('heading', { name: '退款指令' })).toBeVisible();
  await reader.getByRole('button', { name: `${IMPLEMENTATION}:1`, exact: true }).click();
  const focusedLine = source.locator('[data-current-line]').first();
  await expect(focusedLine).toContainText('export function buildRefund');
  await expect(focusedLine).toBeInViewport({ ratio: 1 });
  await expect(focusedLine).toHaveCSS('background-color', 'rgb(41, 62, 96)');
  await expect(focusedLine.locator('span').filter({ hasText: /^export$/ })).toHaveCSS('color', 'rgb(200, 183, 255)');
  if (shots !== undefined) await page.screenshot({ path: join(shots, 'focus-line.png'), animations: 'disabled' });
  await patchSettings(request, { 'ui.theme': ThemeId.Default });
  await expect(source).toHaveCSS('background-color', 'rgb(14, 21, 32)');
  await expect(focusedLine).toHaveCSS('background-color', 'rgb(34, 57, 83)');
});

test.afterAll(({ request }) => patchSettings(request, { 'ui.theme': ThemeId.Codex, 'ui.mode': 'simple' }));

test('交易模板按渠道和版本筛选同码交易，在工作台和离线报告查看处理步骤', async ({ page, request, browser }, info) => {
  const project = await fixtureProject(request);
  const routes = 'src/refund-routes.ts';
  writeFileSync(
    join(project.repoPath, routes),
    [
      "import { submitRefund } from './refunds';",
      'export const refundRoutes = [',
      "  { code: 'RF01', channel: '柜面', version: 'v1', handle: submitRefund },",
      "  { code: 'RF01', channel: '移动端', version: 'v2', handle: mobileRefund },",
      '];',
      'function mobileRefund(order: string) {',
      "  if (!order.trim()) throw new Error('Missing order');",
      '  return submitRefund(order);',
      '}',
    ].join('\n'),
  );
  git(project.repoPath, 'add', routes);
  git(project.repoPath, 'commit', '-m', 'Register two refund channels');
  await page.goto(`/designs/new?projectId=${project.id}`);
  await page.getByRole('radio', { name: /^交易链路探索/ }).check();
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  await expect(page.getByRole('heading', { name: '分析大纲' })).toBeVisible();
  const id = designId(page);
  const draft = await design(request, id);
  expect(draft.templateSnapshot.key).toBe('transaction-explorer');
  const section = draft.sections.find(({ kind }) => kind === DesignSectionKind.Flow);
  if (!section) throw new Error('Missing transaction chapter');
  const outline = await request.put(`${API_BASE}/designs/${id}/outline`, {
    headers: AUTH,
    data: { sections: [{ id: section.id, title: section.title, kind: section.kind, selected: true, scopePaths: [] }] },
  });
  expect(outline.ok(), await outline.text()).toBe(true);
  const versions = [
    { channel: '柜面', version: 'v1' },
    { channel: '移动端', version: 'v2' },
  ];
  const graphs = versions.map(({ channel, version }) => {
    const graph = pendingGraph(DesignDiagramKind.BusinessFlow, `${channel}退款处理`);
    if (version === 'v1') return { ...graph, id: version };
    const routeEdge = { from: 'validate', evidenceClass: DesignEvidenceClass.Static, evidencePath: routes };
    return {
      ...graph,
      id: version,
      nodes: [
        { id: 'validate', label: '检查移动端订单号', targetKind: 'file', relPath: routes },
        ...graph.nodes,
        { id: 'missing', label: '拒绝空订单号', group: '异常出口', summary: '空白订单号不能提交退款。' },
      ],
      edges: [
        ...graph.edges,
        { ...routeEdge, id: 'route', to: 'entry', kind: 'calls', label: '有效订单', lineStart: 8, lineEnd: 8 },
        { ...routeEdge, id: 'reject', to: 'missing', kind: 'reject', label: '订单号为空', lineStart: 7, lineEnd: 7 },
      ],
    };
  });
  const base = chapter(
    section.id,
    '根据退款入口追踪请求校验和退款单构建。',
    DesignDiagramKind.BusinessFlow,
    '退款',
    true,
  );
  if (base.type !== 'callTool') throw new Error('Expected submission');
  await queueDesign(request, project, [
    {
      ...base,
      args: {
        ...base.args,
        diagrams: graphs,
        blocks: [
          {
            type: 'code',
            language: 'typescript',
            relPath: IMPLEMENTATION,
            lineStart: 1,
            lineEnd: 3,
            code: readFileSync(join(project.repoPath, IMPLEMENTATION), 'utf8').split('\n').slice(0, 3).join('\n'),
          },
          ...versions.map(({ channel, version }, index) => ({
            type: 'transaction',
            title: '订单退款',
            code: 'RF01',
            channel,
            version,
            diagramId: version,
            fields: [
              {
                name: 'order',
                steps: ['entry', 'builder'],
                description: '订单号传递给退款单构建函数。',
                evidence: [{ evidenceClass: 'static', relPath: IMPLEMENTATION, lineStart: 4, lineEnd: 5 }],
              },
            ],
            evidence: [{ evidenceClass: 'static', relPath: routes, lineStart: 3 + index, lineEnd: 3 + index }],
          })),
        ],
      },
    },
  ]);
  const generated = await request.post(`${API_BASE}/designs/${id}/generate`, { headers: AUTH, data: {} });
  expect(generated.ok(), await generated.text()).toBe(true);
  await expect.poll(async () => (await design(request, id)).status).toBe(DesignStatus.Ready);
  await page.goto(`/designs/${id}`);
  const exportDir = info.outputPath('交易报告');
  const exported = await request.post(`${API_BASE}/designs/${id}/export`, {
    headers: AUTH,
    data: { targetDir: exportDir },
  });
  expect(exported.ok(), await exported.text()).toBe(true);
  const offline = await browser.newPage({ offline: true });
  const remoteRequests: string[] = [];
  offline.on('request', (request) => {
    if (/^https?:/u.test(request.url())) remoteRequests.push(request.url());
  });
  try {
    await offline.goto(pathToFileURL(join(exportDir, 'index.html')).href);
    for (const reader of [page, offline]) {
      const catalog = reader.getByRole('region', { name: '交易目录' });
      const flow = reader.getByRole('region', { name: '处理链路', exact: true });
      const search = catalog.getByRole('searchbox');
      await expect(catalog.getByRole('button', { name: /RF01/ })).toHaveCount(2);
      await expect(flow.getByRole('button', { name: '拒绝空订单号', exact: true })).toHaveCount(0);
      await search.fill('RF01 移动端 v2');
      await expect(catalog.getByRole('button', { name: /RF01/ })).toHaveCount(1);
      await expect(flow.getByRole('heading', { name: '移动端退款处理' })).toBeVisible();
      const inspector = flow.getByLabel('处理步骤', { exact: true });
      await inspector.getByRole('button', { name: /拒绝空订单号/ }).click();
      await expect(inspector.getByRole('heading', { name: '拒绝空订单号' })).toBeVisible();
      await flow.getByRole('button', { name: '事务边界', exact: true }).click();
      await expect(flow.getByText('本次分析未记录可证实的事务范围。')).toBeVisible();
      await flow.getByRole('button', { name: '源码索引', exact: true }).click();
      await flow.getByRole('button', { name: IMPLEMENTATION, exact: true }).click();
      const dialog = reader.getByRole('dialog', { name: IMPLEMENTATION });
      await expect(dialog).toContainText('export function buildRefund');
      await expect(dialog).not.toContainText('export function submitRefund');
      await dialog.getByRole('button', { name: '关闭源码' }).click();
      await expect(dialog).toHaveCount(0);
      await flow.getByText('字段流转', { exact: true }).click();
      await expect(flow.getByText('订单号传递给退款单构建函数。')).toBeVisible();
      await flow.getByRole('button', { name: '构建退款单', exact: true }).click();
      await expect(inspector.getByRole('heading', { name: '构建退款单' })).toBeVisible();
      await expect(inspector).toContainText('buildRefund');
      await inspector.getByRole('button', { name: 'order', exact: true }).click();
      await expect(flow.getByText('订单号传递给退款单构建函数。')).toBeVisible();
      await search.fill('未知渠道');
      await expect(catalog.getByText('没有匹配的交易。')).toBeVisible();
      await search.fill('');
      await catalog.getByRole('button', { name: /订单退款.*移动端/ }).click();
      await flow.getByRole('button', { name: '构建退款单', exact: true }).press('Enter');
      await expect(flow.getByRole('button', { name: '构建退款单', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const step = flow.getByLabel('处理步骤', { exact: true });
      await expect(step).toContainText('构建退款单');
      await step.getByText('查看对应源码或章节').click();
      await expect(reader.getByRole('heading', { name: FILE_NAME, exact: false }).first()).toBeVisible();
    }
    expect(remoteRequests).toEqual([]);
    const shots = process.env.AW_TRANSACTION_SCREENSHOTS;
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await offline.setViewportSize({ width: 1320, height: 960 });
      await offline.goto(pathToFileURL(join(exportDir, 'index.html')).href);
      await offline.getByRole('button', { name: /订单退款.*移动端/ }).click();
      await page.setViewportSize({ width: 1560, height: 1040 });
      await page.goto(`/designs/${id}`);
      await page.getByRole('button', { name: /订单退款.*移动端/ }).click();
      await page.screenshot({ path: join(shots, 'transaction-workbench.png'), animations: 'disabled' });
      for (const colorScheme of ['light', 'dark'] as const) {
        await offline.emulateMedia({ colorScheme });
        await offline.screenshot({ path: join(shots, `transaction-${colorScheme}.png`) });
      }
    }
  } finally {
    await offline.close();
  }
});

test('AI 规划并生成直接从规划转入第一章', async ({ page, request }) => {
  const project = await fixtureProject(request);
  await page.goto(`/designs/new?projectId=${project.id}`);
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  const start = page.getByRole('button', { name: 'AI 规划并生成' });
  await expect(start).toBeEnabled();
  const id = designId(page);
  for (const theme of [ThemeId.Default, ThemeId.Codex]) {
    await patchSettings(request, { 'ui.theme': theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dir = join(WALKTHROUGH_DIR, 'project-design');
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `planning-${theme}.png`), fullPage: true, animations: 'disabled' });
  }
  await queueDesign(request, project, [
    tool(McpToolName.SubmitDesignOutline, {
      sections: [{ kind: DesignSectionKind.Flow, title: FLOW, scopePaths: [IMPLEMENTATION] }],
    }),
  ]);
  await queueDesign(request, project, [{ type: 'hang' }]);
  await start.click();
  await expect.poll(async () => (await design(request, id)).status).toBe(DesignStatus.Generating);
  const running = await design(request, id);
  expect(running.runs.map(({ kind }) => kind)).toEqual(['outline', 'generate']);
  expect(running.sections.map(({ title }) => title)).toEqual([FLOW]);
  await expect(page.getByRole('button', { name: 'AI 规划并生成' })).toHaveCount(0);
  const stopped = await request.post(`${API_BASE}/designs/${id}/stop`, { headers: AUTH, data: {} });
  expect(stopped.ok(), await stopped.text()).toBe(true);
});
