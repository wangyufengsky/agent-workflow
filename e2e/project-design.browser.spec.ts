import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

function chapters(ids: ChapterIds, pause = false): FakeStep[] {
  return [
    chapter(ids.overview, '总览已提交', DesignDiagramKind.Architecture, GRAPH_TITLES[0], true),
    ...(pause ? [gate(GATES[0])] : []),
    chapter(ids.calls, '调用关系已提交', DesignDiagramKind.CallGraph, GRAPH_TITLES[1]),
    ...(pause ? [gate(GATES[1])] : []),
    chapter(ids.flow, '流程内容已提交', DesignDiagramKind.BusinessFlow, GRAPH_TITLES[2]),
  ];
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
    await expect(offline.getByRole('heading', { name: OVERVIEW, exact: true })).toBeVisible();
    const nav = offline.getByRole('navigation', { name: '章节目录' });
    await expect(nav.getByRole('link', { name: OMIT, exact: true })).toHaveCount(0);
    const article = offline.getByRole('main');
    for (const [index, name] of GRAPH_TITLES.entries()) {
      await nav.getByRole('link', { name, exact: true }).click();
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

    const search = offline.getByRole('searchbox', { name: '搜索章节、文件和符号' });
    await search.fill('退款流程');
    await offline.getByRole('link', { name: FLOW, exact: true }).click();
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
  await expect(page.getByText(/自动识别.*React/)).toBeVisible();
  const template = page.getByRole('group', { name: '分析模板' });
  await expect(template.getByRole('radio', { name: /React.*自动推荐/ })).toBeChecked();
  const java = template.getByRole('radio', { name: /Java.*Spring/ });
  await java.check();
  await expect(java).toBeChecked();
  await page.getByRole('button', { name: '扫描项目并拟定大纲' }).click();
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]+(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '分析大纲' })).toBeVisible();
  const id = designId(page);
  expect((await design(request, id)).templateKey).toBe('java_backend');

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

  await queueDesign(request, project, chapters(ids, true));
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
  await expect(page.getByRole('heading', { name: IMPLEMENTATION, exact: true })).toBeVisible();
  await expect(reader.locator('section[data-highlight]')).toContainText(SYMBOL);

  await search.clear();
  await directory.getByText('文件与符号 · 2', { exact: true }).click();
  await directory.getByRole('button', { name: GRAPH_TITLES[0], exact: true }).click();
  await expect(page.getByRole('heading', { name: GRAPH_TITLES[0], exact: true })).toBeVisible();
  await page.getByText('文本边列表', { exact: false }).click();
  await expect(page.getByText('调用退款构建', { exact: false }).last()).toBeVisible();
  const graph = reader.getByRole('region', { name: GRAPH_TITLES[0], exact: true });
  await graph.getByRole('button', { name: '退款入口', exact: true }).click();
  await expect(page.getByRole('heading', { name: IMPLEMENTATION, exact: true })).toBeVisible();
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
  await queueDesign(request, project, chapters(ids));
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
      await preferences.locator('..').getByLabel(/^主题/).selectOption(theme);
      await preferences.click();
      await expect(page.locator(`body [data-theme="${theme}"]`)).toBeVisible();
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
  await expect(splitter).toHaveAttribute('aria-valuenow', '232');
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '248');
  await page.getByRole('button', { name: '收起目录' }).click();
  await expect(splitter).toHaveCount(0);
  await page.getByRole('button', { name: '展开目录' }).click();
  await expect(splitter).toHaveAttribute('aria-valuenow', '248');

  await page.getByRole('button', { name: '修改设计标题' }).click();
  const title = page.getByRole('textbox', { name: '修改设计标题' });
  await title.fill('退款 · 项目设计');
  await title.press('Enter');
  await expect(page.getByRole('heading', { name: '退款 · 项目设计', exact: true })).toBeVisible();
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
  await expect(page.getByRole('link', { name: /退款服务 项目设计/ })).toBeVisible();
  await page.goto(`/designs/${id}`);
  await expect(page.getByText('项目已删除', { exact: true })).toBeVisible();
  await expect(remove).toBeEnabled();
  await remove.click();
  await confirmation.getByRole('button', { name: '删除设计', exact: true }).click();
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

test.afterAll(({ request }) => patchSettings(request, { 'ui.theme': ThemeId.Codex, 'ui.mode': 'simple' }));
