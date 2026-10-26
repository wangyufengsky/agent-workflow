import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  addFromMenu,
  appTool,
  createProject,
  type E2EProject,
  passReview,
  patchSettings,
  pickWorkflow,
  queueAssistantTurn,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Attachments (30, U-03): the files are real uploads through the input's file picker.
// The file name sorts after onboarding.browser.spec.ts, which needs the shared backend without any project.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

// One project for both: every project in the shared backend makes the Git overview of the walkthrough slower.
let project: E2EProject;
test.beforeAll(async ({ request }) => {
  project = await createProject(request, null);
});

const text = (name: string, content: string, mimeType = 'text/markdown') => ({
  name,
  mimeType,
  buffer: Buffer.from(content),
});

test('开始任务时附上文件：不支持的先移除才能开始，任务页标题下的附件能看到 AI 读到的内容', async ({
  page,
  request,
}) => {
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('修好了')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, /修 Bug/);
  await page.getByLabel('需求').fill('订单搜索不到');
  const picker = page.locator('input[type="file"]');
  const attached = page.getByRole('list', { name: '附加的资料' });

  await picker.setInputFiles([text('screen.png', 'png', 'image/png')]);
  await expect(page.getByRole('status').filter({ hasText: '暂不支持图片' })).toBeVisible();
  await expect(attached).toBeHidden();

  await picker.setInputFiles([
    text('notes.md', '订单号是 12 位数字\n'),
    text('extra.md', '不需要了\n'),
    text('dump.bin', '\u0000\u0001'),
  ]);
  await expect(attached.getByRole('button', { name: '查看 notes.md' })).toBeVisible();
  // An uploaded file removed from the input is deleted on the server too.
  await expect(attached.getByRole('button', { name: '查看 extra.md' })).toBeVisible();
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/attachments/'));
  await attached.getByRole('button', { name: '移除 extra.md' }).click();
  expect((await deleted).status()).toBe(204);
  await expect(attached.getByRole('alert')).toContainText('这个文件读不出文字');
  const start = page.getByRole('button', { name: /^开始/ });
  await expect(start).toBeDisabled();
  await attached.getByRole('button', { name: '移除 dump.bin' }).click();
  await expect(start).toBeEnabled();

  await start.click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });
  await page.getByTestId('task-page').getByRole('button', { name: '查看 notes.md' }).click();
  const preview = page.getByRole('dialog', { name: 'notes.md' });
  await expect(preview).toContainText('订单号是 12 位数字');
  await expect(preview).toContainText('上传的文件');
});

test('问助手时附上文件：消息下面显示附件，可以打开', async ({ page, request }) => {
  await queueAssistantTurn(request, [{ type: 'text', text: '看到了，导出按钮放在右上角。' }]);

  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await addFromMenu(page, '上传文件…');
  await (await chooser).setFiles([text('spec.md', '导出按钮放在右上角\n')]);
  await expect(
    page.getByRole('list', { name: '附加的资料' }).getByRole('button', { name: '查看 spec.md' }),
  ).toBeVisible();
  await page.getByLabel('告诉助手，或开始任务').fill('看看这个需求');
  await page.getByRole('button', { name: '发送', exact: true }).click();

  await expect(page.getByText('看到了，导出按钮放在右上角。')).toBeVisible();
  await page.getByRole('button', { name: '查看 spec.md' }).click();
  await expect(page.getByRole('dialog', { name: 'spec.md' })).toContainText('导出按钮放在右上角');
});

const office = (name: string, fixture: string) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: readFileSync(new URL(`../packages/server/test/fixtures/office/${fixture}`, import.meta.url)),
});

test('附上 Word 与 Excel：卡片显示读到的摘要，旧格式说明怎么另存；预览显示 AI 读到的正文与表格', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await addFromMenu(page, '上传文件…');
  await (await chooser).setFiles([
    office('需求.docx', 'report.libreoffice.docx'),
    office('销售.xlsx', 'sales.libreoffice.xlsx'),
    office('旧表.xls', 'sales.xls'),
  ]);
  const attached = page.getByRole('list', { name: '附加的资料' });
  await expect(attached.getByRole('listitem').filter({ hasText: '需求.docx' })).toContainText('Word · 245 字');
  await expect(attached.getByRole('listitem').filter({ hasText: '销售.xlsx' })).toContainText(
    'Excel · 3 个工作表 · 14 行',
  );
  await expect(attached.getByRole('listitem').filter({ hasText: '旧表.xls' }).getByRole('alert')).toContainText(
    '另存为 .docx / .xlsx',
  );

  await attached.getByRole('button', { name: '查看 需求.docx' }).click();
  const word = page.getByRole('dialog', { name: '需求.docx' });
  await expect(word.getByRole('heading', { name: '订单导出需求' })).toBeVisible();
  await expect(word.getByRole('cell', { name: 'order_id' })).toBeVisible();
  await expect(word).toContainText('图片、图表、批注没有包含');
  await word.getByRole('button', { name: '关闭' }).click();

  await attached.getByRole('button', { name: '查看 销售.xlsx' }).click();
  const excel = page.getByRole('dialog', { name: '销售.xlsx' });
  await expect(excel.getByRole('tab')).toHaveText(['明细', '汇总', '隐藏（隐藏）']);
  await expect(excel.getByRole('row', { name: /^4（隐藏）/ })).toBeVisible();
  await excel.getByRole('tab', { name: '汇总' }).click();
  await expect(excel.getByRole('row', { name: /^6 合计 2791.5/ })).toBeVisible();
});

test('助手生成 Excel：消息里出现文件卡片，可以预览、下载', async ({ page, request }) => {
  await queueAssistantTurn(request, [
    appTool('create_xlsx', {
      file: '区域汇总.xlsx',
      sheets: [
        {
          name: '汇总',
          columns: [{ header: '区域' }, { header: '金额', type: 'currency' }],
          rows: [
            ['华东', 1384],
            ['华北', 707.5],
          ],
        },
      ],
    }),
    { type: 'text', text: '汇总表做好了。' },
  ]);

  await page.goto('/');
  await page.getByLabel('告诉助手，或开始任务').fill('把销售按区域汇总成表格');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('汇总表做好了。')).toBeVisible();

  const card = page.getByRole('region', { name: '助手生成的文件' });
  await expect(card).toContainText('区域汇总.xlsx');
  await expect(card).toContainText('Excel');
  await card.getByRole('button', { name: '预览' }).click();
  const preview = page.getByRole('dialog', { name: '区域汇总.xlsx' });
  await expect(preview).toContainText('Excel · 1 个工作表 · 3 行');
  await expect(preview.getByRole('row', { name: /^3 华北 707.5/ })).toBeVisible();
  await preview.getByRole('button', { name: '关闭' }).click();

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: '另存为…' }).click();
  expect((await download).suggestedFilename()).toBe('区域汇总.xlsx');
});

test('助手修改 Excel：另存为新文件，卡片说明没有保留的内容', async ({ page, request }) => {
  await queueAssistantTurn(request, [
    appTool('create_xlsx', {
      file: '预算.xlsx',
      sheets: [
        {
          name: '预算',
          columns: [{ header: '项目' }, { header: '金额' }],
          rows: [
            ['服务器', 1200],
            ['合计', { formula: 'SUM(B2:B2)' }],
          ],
        },
      ],
    }),
    appTool('edit_xlsx', {
      source: { file: '预算.xlsx' },
      file: '预算（加一行）.xlsx',
      operations: [
        { op: 'insert_rows', sheet: '预算', before: 3, count: 1 },
        { op: 'set_cells', sheet: '预算', start: 'A3', values: [['带宽', 300]] },
      ],
    }),
    { type: 'text', text: '加好了。' },
  ]);

  await page.goto('/');
  await page.getByLabel('告诉助手，或开始任务').fill('预算表里加一行带宽');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('加好了。')).toBeVisible();

  const cards = page.getByRole('region', { name: '助手生成的文件' });
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).not.toContainText('没有保留');
  await expect(cards.nth(1)).toContainText('预算（加一行）.xlsx');
  await expect(cards.nth(1)).toContainText(
    '没有保留原文件的公式引用（插入或删除行列后，1 个公式没有跟着调整，请检查）',
  );
});
