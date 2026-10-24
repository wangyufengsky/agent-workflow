import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  appTool,
  createProject,
  git,
  patchSettings,
  queueAssistantTurn,
  queueTurn,
  startTask,
  submitResult,
} from './helpers.ts';

// J28 (29 §8.1–§8.2): the task page's preview tab. The AI's session opens a page of the preview and leaves frames;
// the user watches them, sees the preview's state with its way on (stopped, failed), and in the browser build is
// pointed to the desktop app for the live page. AI sessions are played by FakeOpencode, pages open in Chromium.

const SERVER = `import { createServer } from 'node:http';
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>订单</title><h1>订单列表</h1>');
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`;

test('J28 任务页预览：观看 AI 的画面，预览停止与启动失败时的画面', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'server.mjs'), SERVER);
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'dev server');
  const preview = { command: 'node server.mjs', setupCommand: null, readyPath: '/', extraOrigins: [] };
  const patch = (value: object) =>
    request.patch(`${API_BASE}/projects/${project.id}`, { headers: AUTH, data: { preview: value } });
  await patch({ ...preview, pages: ['/orders'] });
  await queueTurn(request, project, { title: '定位根因' }, [
    { type: 'callTool', name: 'browser_open', args: { url: '/orders' } },
    submitResult('找到了根因'),
  ]);
  await queueTurn(request, project, { title: '修复' }, [{ type: 'hang' }]);

  await startTask(page, project, /^修 Bug$/, '订单列表空白');
  await page.getByRole('tab', { name: '预览' }).click();
  const pane = page.getByTestId('preview-pane');
  // The AI started the preview; the browser build cannot show the live page.
  await expect(pane).toContainText('页面只在桌面版中显示。');
  await expect(pane.getByRole('link', { name: '在系统浏览器打开' })).toBeVisible();
  await expect(pane).toContainText('运行中');

  await pane.getByLabel('查看').selectOption({ label: 'AI：定位根因' });
  await expect(pane.getByRole('list', { name: '动作' })).toContainText('1. 打开 /orders');
  const frame = pane.getByRole('img', { name: '打开 /orders' });
  await expect(frame).toBeVisible();
  // The picture itself decoded, not only its alt text.
  await expect.poll(() => frame.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await pane.getByLabel('查看').selectOption({ label: '我的预览' });
  await request.post(`${API_BASE}/tasks/${await taskId(page)}/preview/stop`, { headers: AUTH });
  await expect(pane).toContainText('预览已停止');
  await patch({ ...preview, command: `node -e "console.log('boom'); process.exit(1)"`, pages: ['/orders'] });
  await pane.getByRole('button', { name: '重新启动' }).click();
  await expect(pane).toContainText('预览没有启动起来');
  await expect(pane).toContainText('boom');
  await expect(pane.getByRole('link', { name: '修改预览设置' })).toBeVisible();

  await page.getByRole('tab', { name: '进度' }).click();
  await expect(pane).toBeHidden();
  await expect(page).not.toHaveURL(/view=preview/);
  // The fix step keeps working: it would hold one of the AI slots the specs after this one need.
  await request.post(`${API_BASE}/tasks/${await taskId(page)}/cancel`, { headers: AUTH, data: {} });
});

/** The task of the page shown. */
async function taskId(page: import('@playwright/test').Page): Promise<string> {
  const match = /\/tasks\/([^/?]+)/.exec(page.url());
  if (match?.[1] === undefined) throw new Error(`Not on a task page: ${page.url()}`);
  return match[1];
}

test('助手打开任务的预览页签（29 §2.6）', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await request.patch(`${API_BASE}/projects/${project.id}`, {
    headers: AUTH,
    data: {
      preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
    },
  });
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const bugfix = workflows.items.find((w: { key: string }) => w.key === 'bugfix');
  const task = await (
    await request.post(`${API_BASE}/tasks`, {
      headers: AUTH,
      data: {
        projectId: project.id,
        workflowId: bugfix.id,
        requirement: '首页报错',
        checkpoints: { confirm_plan: true },
      },
    })
  ).json();
  await expect
    .poll(async () => (await (await request.get(`${API_BASE}/tasks/${task.id}`, { headers: AUTH })).json()).status)
    .toBe('plan_review');
  await queueAssistantTurn(request, [
    appTool('open_page', { page: 'task_preview', params: { taskId: task.id } }),
    { type: 'text', text: '已打开预览页签。' },
  ]);

  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: '打开助手（⌘J）' }).click();
  const panel = page.getByRole('complementary', { name: '应用助手' });
  // A conversation of its own: the backend is shared with the other specs.
  await panel.getByRole('button', { name: '新对话', exact: true }).click();
  await panel.getByLabel('发给助手的消息').fill('打开这个任务的预览');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  await expect(panel.getByText('已打开预览页签。')).toBeVisible();
  await expect(page).toHaveURL(/view=preview/);
  await expect(page.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('preview-pane')).toBeVisible();
});
