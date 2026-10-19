import { _electron as electron, expect, test } from '@playwright/test';

// AW_E2E_EXECUTABLE points at a packaged app binary; otherwise the built (unpackaged) app is launched.
const executablePath = process.env.AW_E2E_EXECUTABLE;

test('桌面应用启动后台服务并显示界面', async () => {
  const app = await electron.launch(executablePath ? { executablePath } : { args: ['apps/desktop'] });
  const window = await app.firstWindow();
  // Onboarding on a fresh profile, the home page otherwise: either way the renderer reached the backend.
  await expect(window.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await app.close();
});
