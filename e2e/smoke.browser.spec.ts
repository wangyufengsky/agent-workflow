import { expect, test } from '@playwright/test';

test('渲染端通过 API 显示后端健康状态', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('health')).toContainText('后端状态：ok');
});
