import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  appTool,
  box,
  createProject,
  type FakeStep,
  MIN_WINDOW,
  patchSettings,
  queueAssistantTurn,
  queueWriterTurn,
} from './helpers.ts';

// J20 (23 §13): from a project to a PPT — the outline written, edited and confirmed, the pages made one by one, a page
// edited by hand, revised by the AI and restored, another theme, the PowerPoint export, the show and the print view.
// The writer's turns are played by FakeOpencode in the project repository.

const tool = (name: string, args: Record<string, unknown>): FakeStep => ({ type: 'callTool', name, args });
const slide = (page: number, content: Record<string, unknown>, notes = ''): FakeStep =>
  tool('submit_slide', { page, content, notes });

/** File names inside a zip, read from its local file headers (they are stored uncompressed). */
function zipEntries(bytes: Buffer): string[] {
  const names: string[] = [];
  for (
    let at = bytes.indexOf('PK\u0003\u0004', 0, 'latin1');
    at >= 0;
    at = bytes.indexOf('PK\u0003\u0004', at + 4, 'latin1')
  ) {
    const length = bytes.readUInt16LE(at + 26);
    const extra = bytes.readUInt16LE(at + 28);
    names.push(bytes.toString('utf8', at + 30, at + 30 + length));
    at += 30 + length + extra;
  }
  return names;
}

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('J20 项目 → 大纲（改、删、加）→ 逐页制作 → 手改 → 让 AI 改 → 恢复上一版 → 换风格 → 导出 PowerPoint → 放映 → 让助手导出', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueWriterTurn(request, project, [
    { type: 'tool', tool: 'read', input: { filePath: `${project.repoPath}/package.json` } },
    tool('submit_outline', {
      title: '订单服务退款改造',
      understanding: { audience: '团队同事', duration: '约 10 分钟', assumptions: ['听众了解订单服务'] },
      slides: [
        { layout: 'cover', title: '订单服务退款改造', points: ['本周进展'] },
        { layout: 'bullets', title: '为什么要改', points: ['列表接口超时'] },
        { layout: 'quote', title: '结论', points: ['可以上线'] },
      ],
    }),
  ]);

  await page.goto(`/projects/${project.id}`);
  await page.getByRole('link', { name: '做成 PPT' }).click();
  await expect(page.getByRole('heading', { name: '做一份 PPT' })).toBeVisible();
  await expect(page.getByLabel('项目代码')).toHaveValue(project.id);
  await page.getByLabel('这份 PPT 讲什么').fill('向团队汇报退款改造');
  await page.getByRole('button', { name: '文字或文件' }).click();
  await page.getByLabel('添加文字').fill('退款列表超过 10 万条时接口要 8 秒。\n改成分页后 200 毫秒。');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByRole('list', { name: '资料' })).toContainText('退款列表超过 10 万条时接口要 8 秒。');
  await page.getByLabel('指定').check();
  await page.getByRole('spinbutton', { name: '页数' }).fill('3');
  await page.getByRole('button', { name: /^生成大纲/ }).click();

  // The outline, with what the AI understood.
  await expect(page).toHaveURL(/\/ppt\/[0-9a-f-]+$/);
  await expect(page.getByRole('region', { name: 'AI 的理解' })).toContainText('团队同事 · 约 10 分钟');
  await expect(page.getByRole('heading', { name: '订单服务退款改造' })).toBeVisible();
  const pages = page.getByTestId('outline-page');
  await expect(pages).toHaveCount(3);
  // The layout picker keeps to its width; a page's title and points get the rest of the row, down to the smallest window.
  const initial = page.viewportSize() ?? MIN_WINDOW;
  for (const size of [initial, MIN_WINDOW]) {
    await page.setViewportSize(size);
    expect((await box(page.getByLabel('第 2 页 标题'))).width).toBeGreaterThan(400);
    expect((await box(page.getByLabel('第 2 页 要点（每行一条）'))).width).toBeGreaterThan(400);
  }
  await page.setViewportSize(initial);
  await page.getByLabel('第 2 页 标题').fill('接口为什么慢');
  await page.getByLabel('第 2 页 要点（每行一条）').fill('超过 10 万条时 8 秒\n导出只能半夜跑');
  await page.getByRole('button', { name: '删除第 3 页' }).click();
  await expect(pages).toHaveCount(2);
  await page.getByRole('button', { name: '加一页' }).click();
  await page.getByLabel('第 3 页 版式').selectOption('stats');
  await page.getByLabel('第 3 页 标题').fill('改完以后');

  // Made page by page from the edited outline.
  await queueWriterTurn(request, project, [
    slide(1, { layout: 'cover', title: '订单服务退款改造', subtitle: '本周进展' }),
    slide(
      2,
      { layout: 'bullets', title: '接口为什么慢', bullets: ['超过 10 万条时 **8 秒**', '导出只能半夜跑'] },
      '先讲现象',
    ),
    slide(3, { layout: 'stats', title: '改完以后', stats: [{ value: '200 ms', label: '列表接口' }] }),
  ]);
  await page.getByRole('button', { name: '确认大纲，开始制作' }).click();
  await expect(page.getByTestId('slide-thumb')).toHaveCount(3);
  // A thumbnail stays inside its button, so the selected page's outline is whole (2 px border).
  for (const thumb of await page.getByTestId('slide-thumb').all()) {
    const button = await box(thumb);
    expect((await box(thumb.getByTestId('slide-canvas'))).right).toBeLessThanOrEqual(button.right - 2);
  }
  await expect(page.getByTestId('slide-preview')).toContainText('订单服务退款改造');
  await expect(page.getByRole('button', { name: '导出 PowerPoint' })).toBeEnabled();

  // A page edited by hand: the preview follows.
  await page.getByRole('button', { name: '第 2 页 接口为什么慢' }).click();
  const preview = page.getByTestId('slide-preview');
  await expect(preview).toContainText('超过 10 万条时 8 秒');
  const bullets = page.getByLabel('要点（每行一条）');
  await bullets.fill('超过 10 万条时 **8 秒**\n导出只能半夜跑');
  // Typed key by key, as people do: Enter starts a new point and spaces stay while editing.
  await bullets.press('Enter');
  await bullets.pressSequentially('客服 经常收到投诉');
  await expect(bullets).toHaveValue('超过 10 万条时 **8 秒**\n导出只能半夜跑\n客服 经常收到投诉');
  await page.getByLabel('讲稿').click();
  await expect(preview).toContainText('客服 经常收到投诉');

  // In the smallest window the page is still big enough to proofread, and stays in view while its notes are edited.
  await page.setViewportSize(MIN_WINDOW);
  expect((await box(preview)).width).toBeGreaterThan(420);
  await page.getByLabel('讲稿').scrollIntoViewIfNeeded();
  const shown = await preview.boundingBox();
  expect(shown?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((shown?.y ?? 0) + (shown?.height ?? 0)).toBeLessThanOrEqual(MIN_WINDOW.height);
  await page.setViewportSize(initial);

  // The AI revises it; the version before can be restored.
  await queueWriterTurn(request, project, [
    slide(2, { layout: 'bullets', title: '接口为什么慢', bullets: ['10 万条以上要 8 秒'] }),
  ]);
  await page.getByRole('textbox', { name: '让 AI 改' }).fill('精简到一条');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(preview).toContainText('10 万条以上要 8 秒');
  await expect(preview).not.toContainText('客服 经常收到投诉');
  await page.getByRole('button', { name: '恢复上一版' }).click();
  await expect(preview).toContainText('客服 经常收到投诉');

  // Another theme: shown at once, nothing is made again.
  await page.getByLabel('风格').selectOption('default');
  await expect
    .poll(() => preview.getByTestId('slide-canvas').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(14, 15, 18)');

  // PowerPoint: one slide per page, with notes.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PowerPoint' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('订单服务退款改造.pptx');
  const entries = zipEntries(readFileSync(await file.path()));
  expect(entries.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(3);
  expect(entries.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length).toBeGreaterThan(0);

  // The show: arrows page through, Esc goes back to the page shown.
  await page.getByRole('button', { name: '放映' }).click();
  const show = page.getByTestId('ppt-play');
  await expect(show).toContainText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(show).toContainText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('slide-preview')).toContainText('客服 经常收到投诉');

  // The print view the desktop app prints to PDF: every page once.
  const deckId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`/ppt/${deckId}/print`);
  await expect(page.getByTestId('ppt-print').getByTestId('slide-canvas')).toHaveCount(3);

  // The list shows it with its first page.
  await page.goto('/ppt');
  await expect(page.getByTestId('deck-card').filter({ hasText: '订单服务退款改造' })).toContainText('3 页');

  // Asked to, the assistant exports it the way the button does (28 §4): the PPT opens and the file is saved.
  await queueAssistantTurn(request, [
    appTool('export_deck', { deckId, format: 'pptx' }),
    { type: 'text', text: '正在导出，请选择保存位置。' },
  ]);
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await panel.getByRole('button', { name: '新对话', exact: true }).click();
  const exported = page.waitForEvent('download');
  await panel.getByLabel('发给助手的消息').fill('把这份 PPT 导出成 PowerPoint');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  expect((await exported).suggestedFilename()).toBe('订单服务退款改造.pptx');
  await expect(page).toHaveURL(new RegExp(`/ppt/${deckId}$`));
});

test('J32 网页资料：输入地址添加网页 → 生成大纲，网页正文按网站规则只读读取一次并保存（29 §2.8）', async ({
  page,
  request,
}) => {
  const site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<title>上线手册</title><h1>上线手册</h1><p>${req.url === '/runbook' ? '先灰度一成，再全量。' : ''}</p>`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  const url = `http://127.0.0.1:${address.port}/runbook`;
  try {
    await patchSettings(request, { 'browser.sites': [{ pattern: '*', access: 'read' }] });
    const project = await createProject(request, null);
    await queueWriterTurn(request, project, [
      tool('submit_outline', {
        title: '上线手册',
        understanding: { audience: '值班同事', duration: '约 5 分钟', assumptions: [] },
        slides: [{ layout: 'cover', title: '上线手册', points: ['先灰度'] }],
      }),
    ]);

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('link', { name: '做成 PPT' }).click();
    await expect(page.getByLabel('项目代码')).toHaveValue(project.id);
    await page.getByLabel('这份 PPT 讲什么').fill('给值班同事讲上线步骤');
    await page.getByRole('button', { name: '网页', exact: true }).click();
    await page.getByLabel('网页地址').fill(url);
    await page.getByLabel('网页地址').press('Enter');
    const materials = page.getByRole('list', { name: '资料' });
    await expect(materials).toContainText(url);
    await expect(materials).toContainText('网页');
    await page.getByRole('button', { name: /^生成大纲/ }).click();

    await expect(page).toHaveURL(/\/ppt\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: '上线手册' })).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').at(-1);
    const deck = await (await request.get(`${API_BASE}/decks/${id}`, { headers: AUTH })).json();
    expect(deck.materials).toMatchObject([{ kind: 'web', refId: url, title: '上线手册' }]);
  } finally {
    site.close();
  }
});
