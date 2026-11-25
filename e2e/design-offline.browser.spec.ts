import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { layoutDesignDiagram, SYSTEM_THEME_MAP } from '@aw/shared';
import { THEMES } from '@aw/shared/theme';
import { expect, test } from '@playwright/test';

import { designSiteStylesheet } from '../packages/server/src/modules/designs/designs.site-style.ts';

const assets = fileURLToPath(new URL('../packages/server/src/modules/designs/site-assets', import.meta.url));
const copy = new URL('../apps/web/src/copy/design-site.json', import.meta.url);
const nodes = [
  { id: 'order', label: '订单入口', targetKind: 'module', targetId: 'orders' },
  { id: 'store', label: '存储符号', targetKind: 'symbol', targetId: 'commit', relPath: 'src/store.ts' },
];
const edges = [
  {
    id: 'call',
    from: 'order',
    to: 'store',
    kind: 'call',
    label: '存入',
    evidenceClass: 'static',
    evidencePath: 'src/store.ts',
    lineStart: 3,
    lineEnd: 4,
  },
  {
    id: 'return',
    from: 'store',
    to: 'order',
    kind: 'callback',
    label: '回调',
    evidenceClass: 'inferred',
    rationale: '事件监听器按配置注入。',
  },
];
const model = {
  title: '订单设计',
  sections: [
    {
      id: 'overview',
      kind: 'overview',
      title: '项目总览',
      summary: '请求由订单模块处理。',
      blocks: [
        { type: 'markdown', title: '正文', markdown: '订单入口调用数据库。' },
        { type: 'diagram_ref', diagramId: 'graph' },
      ],
    },
    {
      id: 'orders',
      kind: 'module',
      title: '订单模块',
      summary: '保存订单。',
      blocks: [
        {
          type: 'submodule',
          id: 'persistence',
          title: '存储子模块',
          summary: '执行写入。',
          files: ['src/store.ts'],
          behaviors: [
            {
              title: '如何写入订单？',
              markdown: '通过提交函数保存订单。',
              evidence: [{ evidenceClass: 'static', relPath: 'src/store.ts', lineStart: 4, lineEnd: 4 }],
            },
          ],
        },
        {
          type: 'code',
          relPath: 'src/store.ts',
          language: 'typescript',
          lineStart: 3,
          lineEnd: 4,
          code: 'function commit() {\n  return 42;',
        },
      ],
    },
    { id: 'flow', kind: 'flow', title: '异常路径', summary: '请求失败时响应错误。', blocks: [] },
  ],
  files: [
    {
      id: 'store-file',
      sectionId: 'orders',
      relPath: 'src/store.ts',
      responsibility: '保存订单',
      symbols: [
        {
          id: 'commit',
          name: 'commit',
          qualifiedName: 'Store.commit',
          kind: 'method',
          signature: 'commit(order): void',
          lineStart: 3,
          lineEnd: 4,
          summary: '提交订单。',
        },
      ],
    },
  ],
  diagrams: [
    {
      id: 'graph',
      sectionId: 'overview',
      kind: 'call_graph',
      title: '订单调用图',
      nodes,
      edges,
      layout: layoutDesignDiagram(nodes, edges),
    },
  ],
};

test('离线图谱置顶并允许键盘查看边证据及下钻符号', async ({ page, context }, info) => {
  const root = info.outputPath('离线 站点');
  await cp(assets, join(root, 'assets'), { recursive: true });
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="assets/style.css"><script defer src="model.js"></script><script defer src="assets/viewer.js"></script><div id="design-site"></div>',
  );
  const labels = await readFile(copy, 'utf8');
  const external: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const index = pathToFileURL(join(root, 'index.html')).href;
  const stylesheet = await readFile(join(assets, 'style.css'), 'utf8');
  const open = async (layoutStyle: 'arch' | 'doc', sections = model.sections) => {
    await writeFile(join(root, 'assets', 'style.css'), designSiteStylesheet(stylesheet));
    await writeFile(
      join(root, 'model.js'),
      `window.__AW_DESIGN_SITE_COPY__ = ${labels};window.__AW_DESIGN_DATA__ = ${JSON.stringify({ ...model, sections, layoutStyle })};`,
    );
    await page.goto(index);
  };
  await open('arch');
  await expect(page.getByRole('heading', { name: model.title })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: '项目大纲' })).toBeVisible();
  const homeGraph = main.getByRole('group', { name: '组成', exact: true });
  await expect(homeGraph.getByRole('link', { name: '异常路径' })).toHaveCount(0);
  await main.getByRole('link', { name: /异常路径/ }).click();
  await expect(main.getByRole('heading', { name: '异常路径' })).toBeVisible();
  await main.getByRole('navigation', { name: '面包屑' }).getByRole('link', { name: model.title }).click();
  await expect(homeGraph).toBeVisible();
  const initialViewBox = await homeGraph.getAttribute('viewBox');
  await homeGraph.press('ArrowRight');
  await expect(homeGraph).not.toHaveAttribute('viewBox', initialViewBox ?? '');
  await homeGraph.press('+');
  await homeGraph.press('Home');
  await expect(homeGraph).toHaveAttribute('viewBox', initialViewBox ?? '');

  await homeGraph.getByRole('link', { name: '订单模块' }).press('Space');
  await expect(main.getByRole('heading', { name: '订单模块' })).toBeVisible();
  await main.getByRole('group', { name: '组成', exact: true }).getByRole('link', { name: '存储子模块' }).press('Enter');
  await expect(main.getByRole('heading', { name: '如何写入订单？' })).toBeVisible();
  await main.getByRole('link', { name: 'src/store.ts:4' }).click();
  await expect(page.locator('.code-line[data-focus]')).toHaveAttribute('data-line', '4');
  await expect(page.locator('.code-line[data-line="4"] .syntax-keyword')).toHaveText('return');
  await expect(
    page.getByRole('navigation', { name: '面包屑' }).getByRole('link', { name: '存储子模块' }),
  ).toBeVisible();
  await page.getByRole('navigation', { name: '章节目录' }).getByRole('link', { name: '项目总览', exact: true }).click();
  const article = page.locator('main article').first();
  const graph = article.getByRole('group', { name: '订单调用图' });
  await expect(graph).toHaveCount(1);
  const graphPrecedesText = () =>
    graph.evaluate((canvas) => {
      const prose = canvas.closest('article')?.querySelector('.content-block');
      return prose != null && Boolean(canvas.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  expect(await graphPrecedesText()).toBe(true);

  const evidence = page.getByRole('region', { name: '关系证据' });
  const direct = graph.getByRole('button', { name: /存入.*静态确认/ });
  await direct.press('Enter');
  await expect(direct).toHaveAttribute('aria-pressed', 'true');
  await expect(evidence.getByRole('link', { name: /src\/store\.ts:3/ })).toBeVisible();
  const inferred = graph.getByRole('button', { name: /回调.*AI 推断/ });
  await inferred.press('Space');
  await expect(direct).toHaveAttribute('aria-pressed', 'false');
  await expect(evidence).toContainText('事件监听器按配置注入。');
  await inferred.press('Escape');
  await expect(evidence).toBeHidden();

  await graph.getByRole('link', { name: '存储符号' }).press('Enter');
  await expect(page).toHaveURL(/#file\/store-file\/commit$/);
  await expect(page.locator('.symbol.highlight')).toContainText('Store.commit');

  await open('doc');
  await page.getByRole('navigation', { name: '章节目录' }).getByRole('link', { name: '项目总览', exact: true }).click();
  await expect(main.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await expect(graph).toBeVisible();
  expect(await graphPrecedesText()).toBe(false);
  await expect(page.getByRole('heading', { name: '模块与文件' })).toHaveCount(0);
  await page.goto(`${index}#file/store-file//4/4`);
  const source = page.locator('.source-excerpts pre');
  const codeLine = source.locator('.code-line[data-focus]');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const theme = SYSTEM_THEME_MAP[scheme];
    await expect(source).toHaveCSS('background-color', scheme === 'light' ? 'rgb(23, 34, 53)' : 'rgb(14, 21, 32)');
    await expect(codeLine).toHaveCSS('background-color', scheme === 'light' ? 'rgb(41, 62, 96)' : 'rgb(34, 57, 83)');
    await expect(codeLine.locator('.syntax-keyword')).toHaveCSS('color', 'rgb(200, 183, 255)');
    await expect(codeLine.locator('.syntax-number')).toHaveCSS('color', 'rgb(255, 209, 140)');
    await expect(codeLine.locator('.code-number')).toHaveCSS('color', 'rgb(168, 184, 206)');
    const actual = await page.locator('html').evaluate((root) => {
      const computed = getComputedStyle(root);
      return [
        computed.colorScheme,
        computed.getPropertyValue('--bg').trim(),
        computed.getPropertyValue('--ink').trim(),
      ];
    });
    expect(actual).toEqual([THEMES[theme].colorScheme, THEMES[theme].tokens.bg, THEMES[theme].tokens.ink]);
  }
  await open(
    'arch',
    model.sections.filter(({ kind }) => kind !== 'overview'),
  );
  await expect(main.locator('.summary')).toHaveText('保存订单。');
  await expect(homeGraph.getByRole('link', { name: '订单模块' })).toBeVisible();
  await expect(homeGraph.getByRole('link', { name: '异常路径' })).toHaveCount(0);
  expect(external).toEqual([]);
});
