import { _electron as electron, expect, test } from '@playwright/test';

// AW_E2E_EXECUTABLE points at a packaged app binary; otherwise the built (unpackaged) app is launched.
const executablePath = process.env.AW_E2E_EXECUTABLE;

test('桌面应用启动后台服务并显示健康状态', async () => {
  const app = await electron.launch(executablePath ? { executablePath } : { args: ['apps/desktop'] });
  const window = await app.firstWindow();
  await expect(window.getByTestId('health')).toContainText('后端状态：ok');
  await app.close();
});
