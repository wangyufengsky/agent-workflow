import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

test('设置页滚到底再向上滚动，顶栏与侧栏留在视口中且无整页黑色空白', async ({ page, request }) => {
  await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': 'default', 'companion.appearance': 'whale' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/settings');
  await page.getByRole('heading', { name: '关于', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('main').hover();
  await page.mouse.wheel(0, 3000);
  // 模型列表、字体等加载会改变页面高度；验证当前滚动终点而非加载前的旧高度。
  await expect
    .poll(() => page.getByRole('main').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBe(0);
  const bottom = await page.getByRole('main').evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.getByRole('main').evaluate((el) => el.scrollTop)).toBeLessThan(bottom);
  await expect(page.getByRole('banner')).toBeInViewport({ ratio: 1 });
  const navigation = await page.getByRole('navigation', { name: 'Agent Workflow' }).boundingBox();
  expect(navigation).toMatchObject({ y: 0, height: 800 });
  expect(
    await page.evaluate(() => ({ scroll: window.scrollY, height: document.documentElement.scrollHeight })),
  ).toEqual({ scroll: 0, height: 800 });
  await page.screenshot({ path: 'screenshots/companion/settings-scroll.png' });
  await expect(page.getByRole('banner')).toBeInViewport({ ratio: 1 });
});
