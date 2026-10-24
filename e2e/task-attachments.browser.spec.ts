import { expect, test } from '@playwright/test';
import {
  addFromMenu,
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
  await expect(attached.getByRole('alert')).toContainText('目前只支持文本文件');
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
