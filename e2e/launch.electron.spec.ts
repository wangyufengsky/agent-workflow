import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Electron smoke for CI on every platform (17 §4.1): the built app starts its backend, shows onboarding with the
// checks answered, and quits cleanly (main waits for the backend to stop opencode and exit). No opencode or model
// is needed; the full journey with them is J10. The window comes first with the opening animation, which a click
// skips (28 §5, D113).
test('构建后的应用启动后显示引导页并能正常退出', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-launch-'));
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
  await page.mouse.click(10, 10);

  await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  await expect(page.getByTestId('check-Git')).toContainText('已就绪');
  await expect(page.getByTestId('check-opencode 1.19.0')).toBeVisible();
  await expect(page.getByTestId('check-凭据存储')).toBeVisible();
  // The next start shows its window in the theme the renderer applied, before the backend is up (28 §5.3).
  const launchFile = join(userDataDir, 'launch.json');
  await expect.poll(() => existsSync(launchFile)).toBe(true);
  expect(JSON.parse(readFileSync(launchFile, 'utf8'))).toMatchObject({ intro: true });

  await app.close();
});
