import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { layoutDesignDiagram } from '@aw/shared';
import { expect, test } from '@playwright/test';

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
  theme: 'dracula',
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
    { id: 'orders', kind: 'module', title: '订单模块', summary: '保存订单。', blocks: [] },
  ],
  files: [
    {
      id: 'store-file',
      sectionId: 'overview',
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
  const open = async (layoutStyle: 'arch' | 'doc') => {
    await writeFile(
      join(root, 'model.js'),
      `window.__AW_DESIGN_SITE_COPY__ = ${labels};window.__AW_DESIGN_DATA__ = ${JSON.stringify({ ...model, layoutStyle })};`,
    );
    await page.goto(index);
  };
  await open('arch');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
  const article = page.locator('main article').first();
  const graph = article.getByRole('group', { name: '订单调用图' });
  await expect(graph).toHaveCount(1);
  const graphPrecedesText = () =>
    article.locator('.graph-canvas').evaluate((canvas) => {
      const prose = canvas.closest('article')?.querySelector('.content-block');
      return prose != null && Boolean(canvas.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  expect(await graphPrecedesText()).toBe(true);
  await expect(article.locator('.architecture-card').filter({ hasText: '订单模块' })).toBeVisible();

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
  await expect(page.getByRole('heading', { name: '正文' })).toBeVisible();
  expect(await graphPrecedesText()).toBe(false);
  await expect(page.getByRole('heading', { name: '模块与文件' })).toHaveCount(0);
  expect(external).toEqual([]);
});
