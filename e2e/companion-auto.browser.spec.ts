import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { patchSettings } from './helpers.ts';

// 先于创建项目的旅程运行：自动碎碎念只有全局空闲才触发。
test('自动碎碎念遵守间隔，聊天或关闭自动开关时不调用模型', async ({ page, request }) => {
  await patchSettings(request, { 'companion.whisper': true, 'companion.whisperMinutes': 1 });
  try {
    await page.clock.install();
    let generations = 0;
    page.on('request', (sent) => {
      if (new URL(sent.url()).pathname === '/api/v1/assistant/whisper') generations += 1;
    });
    await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
      headers: AUTH,
      data: { match: { agent: 'aw-companion' }, steps: [{ type: 'text', text: '我在这里陪你。' }] },
    });
    await page.goto('/companion');
    await expect(page.locator('[data-size="pet"]')).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(page.getByText('我在这里陪你。', { exact: true })).toBeVisible();
    expect(generations).toBe(1);
    await page.getByRole('button', { name: '和我说说话', exact: true }).click();
    await expect(page.getByLabel('发给助手的消息')).toBeFocused();
    await page.clock.fastForward(120_000);
    expect(generations).toBe(1);
    await patchSettings(request, { 'companion.whisper': false });
    await page.getByRole('button', { name: '收起对话' }).click();
    await page.clock.fastForward(120_000);
    expect(generations).toBe(1);
  } finally {
    await patchSettings(request, { 'companion.whisper': false, 'companion.whisperMinutes': 15 });
  }
});
