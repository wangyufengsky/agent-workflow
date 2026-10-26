import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

// J26 (29 §8.5, §8.6): the project's page preview saved and tried in the main workspace, a failing start showing its
// log; the website rules edited, reordered and saved; in the browser build the login window points to the desktop app.

/** A dev server without dependencies, listening on PORT as the preview asks. */
const SERVER = `import { createServer } from 'node:http';
createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`;

test('J26 页面预览：保存设置、试运行成功与失败', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'server.mjs'), SERVER);
  await page.goto(`/projects/${project.id}`);
  const panel = page.getByRole('region', { name: '页面预览' });

  await panel.getByLabel('启动命令').fill('node server.mjs');
  await panel.getByLabel('关键页面').fill('/\n/orders');
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('页面预览设置已保存')).toBeVisible();
  await page.reload();
  await expect(panel.getByLabel('启动命令')).toHaveValue('node server.mjs');
  await expect(panel.getByLabel('关键页面')).toHaveValue('/\n/orders');

  await panel.getByRole('button', { name: '试运行' }).click();
  await expect(panel.getByRole('status')).toContainText(/已在 http:\/\/127\.0\.0\.1:\d+ 就绪，随后已停止。/);
  await expect(panel.getByRole('status')).toContainText('listening');

  await panel.getByLabel('启动命令').fill(`node -e "console.log('boom'); process.exit(1)"`);
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('页面预览设置已保存')).toBeVisible();
  await panel.getByRole('button', { name: '试运行' }).click();
  await expect(panel.getByRole('alert')).toContainText('页面预览没能启动');
  await expect(panel.getByText('boom', { exact: false })).toBeVisible();
});

test('J26 网站规则：添加、改权限、排序后保存；浏览器版不显示登录窗口', async ({ page, request }) => {
  // Website rules and logins are pro-mode settings (38 C5).
  await patchSettings(request, {
    'ui.theme': 'codex',
    'ui.mode': 'pro',
    'browser.sites': [{ pattern: '*', access: 'read' }],
  });
  await page.goto('/settings');
  const panel = page.getByRole('region', { name: '网站' });
  const rules = panel.getByRole('list', { name: '网站' }).getByRole('listitem');
  await expect(rules).toHaveCount(1);
  await expect(rules.first().getByLabel('地址')).toHaveValue('*');

  await panel.getByRole('button', { name: '添加规则' }).click();
  await rules.nth(1).getByLabel('地址').fill('wiki.corp');
  await rules.nth(1).getByRole('button', { name: '可操作' }).click();
  await rules.nth(1).getByRole('button', { name: '上移' }).click();
  await panel.getByRole('button', { name: '保存规则' }).click();
  await expect(page.getByText('网站规则已保存')).toBeVisible();

  await page.reload();
  await expect(rules).toHaveCount(2);
  await expect(rules.first().getByLabel('地址')).toHaveValue('wiki.corp');
  await expect(rules.first().getByRole('button', { name: '可操作' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rules.nth(1).getByLabel('地址')).toHaveValue('*');

  await expect(panel.getByText('登录窗口只在桌面版中显示。')).toBeVisible();
  await expect(panel.getByRole('button', { name: '打开并登录' })).toBeDisabled();
  await expect(panel.getByText('还没有登录过的网站。')).toBeVisible();
});
