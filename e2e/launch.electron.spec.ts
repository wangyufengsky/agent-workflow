import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Electron smoke for CI on every platform (17 §4.1): the built app starts its backend, shows onboarding with the
// checks answered, and quits cleanly (main waits for the backend to stop opencode and exit). No opencode or model
// is needed; the full journey with them is J10.
test('构建后的应用启动后显示引导页并能正常退出', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-launch-'));
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  const page = await app.firstWindow();

  await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  await expect(page.getByTestId('check-Git')).toContainText('已就绪');
  await expect(page.getByTestId('check-opencode 1.19.0')).toBeVisible();
  await expect(page.getByTestId('check-凭据存储')).toBeVisible();

  await app.close();
});
