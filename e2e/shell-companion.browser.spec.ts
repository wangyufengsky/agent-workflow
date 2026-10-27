import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  passReview,
  patchSettings,
  queueAssistantTurn,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test('默认光球可预览工作与完成动画，切换鲸鱼会持久化并遵守减少动态效果', async ({ page, request }) => {
  await createProject(request, null);
  await patchSettings(request, {
    'companion.appearance': 'orb',
    'companion.animations': true,
    'ui.theme': 'codex',
  });
  await page.goto('/settings');
  const shape = page.getByLabel('AI 助手形象', { exact: true });
  await expect(shape).toHaveValue('orb');
  const preview = page.locator('[data-size="lg"]');
  await page.getByRole('button', { name: '工作环绕', exact: true }).click();
  await expect(preview).toHaveAttribute('data-mood', 'working');
  await expect(preview.locator('canvas')).toHaveAttribute('data-active', 'true');
  expect(
    await preview.evaluate((el) =>
      el.getAnimations({ subtree: true }).some((a) => a.effect?.getTiming().iterations === Infinity),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '完成庆祝', exact: true }).click();
  await expect(preview).toHaveAttribute('data-mood', 'success');
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/companion/orb-light.png' });
  await shape.selectOption('whale');
  await expect(preview).toHaveAttribute('data-appearance', 'whale');
  await expect
    .poll(() => preview.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(shape).toHaveValue('whale');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(preview.locator('video')).toHaveCount(0);
  await expect(preview.locator('img')).toBeVisible();
  await patchSettings(request, { 'ui.theme': 'default' });
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/companion/whale-dark.png' });
  await shape.selectOption('orb');
  await expect(preview).toHaveAttribute('data-animated', 'false');
  await expect(preview.locator('canvas')).toHaveAttribute('data-active', 'false');
  await expect(preview.locator('img')).toBeVisible();
  // 主题切换的颜色过渡与角色的循环 CSS 动画不同；减少动态效果须停用后者。
  expect(
    await preview.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).length),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(preview.locator('canvas')).toHaveAttribute('data-active', 'true');
  await page.screenshot({ path: 'screenshots/companion/aurora-dark.png' });
  // The animation switch is a pro-mode setting (38 C5).
  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.getByRole('switch', { name: '播放角色动画', exact: true }).click();
  await expect(preview.locator('canvas')).toHaveAttribute('data-active', 'false');
  await expect(preview.locator('img')).toBeVisible();
  await patchSettings(request, { 'ui.mode': 'simple' });
});

test('极光失去 GPU 上下文后保留静态形象', async ({ page, request }) => {
  await patchSettings(request, { 'companion.appearance': 'orb', 'companion.animations': true });
  await page.goto('/companion');
  const orb = page.locator('[data-size="pet"]');
  await expect(orb.locator('canvas')).toHaveAttribute('data-active', 'true');
  await orb.locator('canvas').evaluate((node: HTMLCanvasElement) => {
    const extension = node.getContext('webgl')?.getExtension('WEBGL_lose_context');
    if (extension === null || extension === undefined) throw new Error('Context loss extension unavailable');
    extension.loseContext();
  });
  await expect(orb.locator('canvas')).toHaveAttribute('data-active', 'false');
  await expect(orb.locator('img')).toBeVisible();
});

test('桌宠页面复用助手聊天、碎碎念隔离，鲸鱼素材失败有显式提示', async ({ page, request }) => {
  await patchSettings(request, {
    'companion.appearance': 'orb',
    'companion.whisper': false,
    'companion.animations': true,
  });
  await page.goto('/companion');
  const pet = page.getByRole('button', { name: '和我说说话', exact: true });
  await pet.click();
  await queueAssistantTurn(request, [{ type: 'text', text: '这是桌面助手的同一条回复。' }]);
  await page.getByLabel('发给助手的消息').fill('桌面聊天测试');
  await page.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  await expect(page.getByText('这是桌面助手的同一条回复。', { exact: true })).toBeVisible();
  const list = await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json();
  const count = list.items.length;
  await page.getByRole('button', { name: '收起对话' }).click();
  await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { agent: 'aw-companion' }, steps: [{ type: 'text', text: '记得伸个懒腰呀。' }] },
  });
  await pet.click({ button: 'right' });
  await page.getByRole('button', { name: '说一句碎碎念' }).click();
  await expect(page.getByText('记得伸个懒腰呀。', { exact: true })).toBeVisible();
  expect(
    (await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json()).items.length,
  ).toBe(count);
  await page.route('**/companion/whale/*.webm', (route) => route.abort());
  await patchSettings(request, { 'companion.appearance': 'whale' });
  await expect(page.getByText('角色动画加载失败', { exact: true })).toBeVisible();
  await patchSettings(request, { 'companion.appearance': 'orb' });
});

test('真实任务事件驱动光球庆祝，待检查与完成分别提醒，任务进入下一状态时撤回旧提醒', async ({ page, request }) => {
  const project = await createProject(request, null);
  await patchSettings(request, { 'companion.appearance': 'orb' });
  await page.goto('/companion');
  await expect(page.locator('[data-size="pet"]')).toBeVisible();
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('原因已找到')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'notice.ts', content: 'export const fixed = true;\n' },
    submitResult('完成修复'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const workflow = workflows.items.find((item: { key: string }) => item.key === 'bugfix');
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId: project.id, workflowId: workflow.id, requirement: '验证角色任务通知' },
  });
  expect(created.ok()).toBe(true);
  const task = await created.json();
  await expect(page.getByText('已经准备好，等你检查', { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.locator('[data-size="pet"]')).toHaveAttribute('data-mood', 'success');
  const delivered = await request.post(`${API_BASE}/tasks/${task.id}/deliver`, {
    headers: AUTH,
    data: { strategy: 'squash' },
  });
  expect(delivered.ok()).toBe(true);
  await expect(page.getByText('任务完成啦', { exact: true })).toBeVisible();
  await expect(page.getByText('已经准备好，等你检查', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  // 全套旅程共享后端，其他任务仍可能运行；结束庆祝后回到实时工作状态。
  await expect(page.locator('[data-size="pet"]')).not.toHaveAttribute('data-mood', 'success');
  await page.reload();
  await expect(page.locator('[data-size="pet"]')).toBeVisible();
  await expect(page.getByText('任务完成啦', { exact: true })).toHaveCount(0);
});
