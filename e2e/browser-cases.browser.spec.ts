import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { createProject } from './helpers.ts';

test('项目保存用例、确认后运行，并展开失败步骤的截图和请求', async ({ page, request }) => {
  const target = createServer((req, res) => {
    if (req.url === '/api/save') {
      res.writeHead(201).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`
      <button id="save">保存</button><p id="status">草稿</p>
      <script>
        document.querySelector('#save').addEventListener('click', async () => {
          await fetch('/api/save', { method: 'POST' });
          document.querySelector('#status').textContent = '已保存';
        });
      </script>`);
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  try {
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a local HTTP port');
    const project = await createProject(request, null);
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: '新建用例' }).click();
    const editor = page.getByRole('dialog', { name: '新建用例' });
    await editor.getByLabel('用例名称').fill('订单回归');
    await editor.getByLabel('测试地址').fill(`http://127.0.0.1:${address.port}/orders`);
    await editor.getByLabel('允许写入的接口').fill('POST /api/save');
    await editor.getByLabel('步骤名称').fill('提交订单');
    await editor.getByLabel('操作元素的 CSS 选择器').fill('#save');
    await editor.getByLabel('待验证元素的 CSS 选择器').fill('#status');
    await editor.getByLabel('预期值').fill('已发布');
    await editor.getByRole('button', { name: '保存用例' }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: '运行', exact: true }).click();
    const approval = page.getByRole('dialog', { name: '订单回归' });
    const run = approval.getByRole('button', { name: '确认并运行' });
    await expect(run).toBeDisabled();
    await approval.getByRole('checkbox').check();
    await run.click();
    const report = page.getByRole('region', { name: '浏览器测试用例' });
    await expect(report.getByText('步骤 1 · 提交订单 · 失败')).toBeVisible({ timeout: 15_000 });
    await expect(report.getByText('实际 · 已保存')).toBeVisible();
    await expect(report.getByRole('img', { name: '失败截图' })).toBeVisible();
    const failed = report.locator('li').filter({ hasText: '步骤 1 · 提交订单 · 失败' });
    await failed.locator('summary').click();
    await expect(report.getByText(/POST .*\/api\/save · 201/)).toBeVisible();
    await expect(page.getByRole('button', { name: '复跑本次用例版本' })).toBeVisible();

    await page.goBack();
    await page.getByRole('button', { name: '编辑用例' }).click();
    const editing = page.getByRole('dialog', { name: '编辑用例' });
    await expect(editing.getByLabel('预期值')).toHaveValue('已发布');
    await editing.getByLabel('预期值').fill('已保存');
    await editing.getByRole('button', { name: '保存用例' }).click();
    await expect(editing).toBeHidden();
    await expect(page.getByText(`http://127.0.0.1:${address.port}/orders · 版本 2`, { exact: true })).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) =>
      target.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});
