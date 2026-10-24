import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  type E2EProject,
  git,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
} from './helpers.ts';

// J29 (29 §7, §8.3–§8.4): the page check of the bug-fix workflow's fix step. A broken page fails it and the step's
// next attempt fixes it; the step's details show each page with its screenshot, its browser action with the frame,
// and the result card the pages. A preview that never starts cannot run the check: the user skips it. AI sessions
// are played by FakeOpencode, pages open in Chromium.

/** Serves the worktree's index.html as it is now. */
const SERVER = `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync('index.html'));
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`;
const html = (body: string) =>
  `<!doctype html><html lang="zh"><head><title>订单</title></head><body>${body}</body></html>`;

async function previewProject(request: Parameters<typeof createProject>[0], command: string): Promise<E2EProject> {
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'server.mjs'), SERVER);
  writeFileSync(join(project.repoPath, 'index.html'), html(`<h1>订单</h1><script>console.error('boom')</script>`));
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'dev server');
  await request.patch(`${API_BASE}/projects/${project.id}`, {
    headers: AUTH,
    data: { preview: { command, setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] } },
  });
  return project;
}

/** Decoded, not only its alt text. */
const decoded = (image: ReturnType<Page['getByRole']>) =>
  expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

test('J29 页面体检不通过 → 下一次尝试修好后通过；步骤详情看每页与动作画面，结果卡显示页面', async ({
  page,
  request,
}) => {
  const project = await previewProject(request, 'node server.mjs');
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('页面脚本报错')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('改好了')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'index.html', content: html('<h1>订单</h1>') },
    { type: 'callTool', name: 'browser_open', args: { url: '/' } },
    submitResult('去掉了报错的脚本'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /^修 Bug$/, '订单页控制台报错');
  const result = page.getByTestId('result-card');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const pages = result.getByTestId('result-pages');
  await expect(pages.getByRole('link', { name: '打开预览' })).toBeVisible();
  await decoded(pages.getByRole('img', { name: '放大 /（桌面）' }));

  const { pathname } = new URL(page.url());
  const task = await (await request.get(`${API_BASE}${pathname}`, { headers: AUTH })).json();
  const fix = task.nodes.find((n: { key: string }) => n.key === 'fix');
  await page.goto(`${pathname}?node=${fix.id}&open=true`);
  const drawer = page.getByRole('dialog');
  await drawer.getByText('页面体检').click();
  const check = drawer.getByTestId('page-check');
  await expect(check).toContainText('/');
  await expect(check).toContainText('桌面');
  await expect(check).toContainText('手机');
  await expect(check).not.toContainText('未通过');
  await check.getByRole('button', { name: '放大 /（手机）' }).click();
  await decoded(page.getByRole('dialog', { name: '/ · 手机' }).getByRole('img'));
  await page.keyboard.press('Escape');

  await page.goto(`${pathname}?node=${fix.id}&open=true&tab=process`);
  // The ended attempt's stream is folded into one line first, its calls in a row into a group.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /执行过程/ })
    .last()
    .click();
  await page.getByRole('dialog').getByTestId('stream-group').getByRole('button').first().click();
  await page.getByRole('dialog').getByTestId('stream-action').filter({ hasText: '打开' }).getByRole('button').click();
  await decoded(page.getByRole('dialog').getByRole('img', { name: /^画面/ }).last());
});

test('J29 预览从没启动过：页面体检无法运行，不重做 AI；跳过后继续，结果卡写明未验证', async ({ page, request }) => {
  const project = await previewProject(request, `node -e "console.log('cannot start'); process.exit(1)"`);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('页面脚本报错')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('改好了')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /^修 Bug$/, '订单页控制台报错');
  const failure = page.getByTestId('failure-panel');
  await expect(failure).toContainText('步骤「修复」的页面体检没法运行', { timeout: 30_000 });
  await expect(failure.getByRole('button', { name: '重新检查' })).toBeVisible();
  await expect(failure.getByRole('link', { name: '修改页面预览设置' })).toBeVisible();
  await failure.getByText('预览日志末尾').click();
  await expect(failure).toContainText('cannot start');

  await failure.getByRole('button', { name: '跳过这项检查…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '跳过并继续' }).click();
  await expect(page.getByTestId('result-card')).toContainText('有 1 项检查没有运行：页面体检（已跳过）', {
    timeout: 30_000,
  });
});
