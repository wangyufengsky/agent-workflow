import { MCP_ASSISTANT_TOOL_PREFIX } from '@aw/shared';
import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, queueAssistantTurn } from './helpers.ts';

test('助手历史里的异常工具参数仍可查看，打开会话后可直接切换和新建对话', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [
    {
      type: 'tool',
      tool: `${MCP_ASSISTANT_TOOL_PREFIX}tasks_create`,
      input: { functionalTest: { writes: 'POST' }, workflowId: null, legacyField: '旧参数' },
      output: 'Invalid input',
    },
    { type: 'text', text: '这一条消息仍可阅读。' },
  ]);
  await page.goto(`/?projectId=${project.id}`);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await input.fill('查看测试任务');
  await input.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/[?&]conversation=/);
  const history = page.url();
  await page.goto('/settings');
  await page.goto(history);
  const stream = page.getByTestId('home-messages');
  await expect(stream).toContainText('这一条消息仍可阅读。');
  const action = stream.getByTestId('assistant-action');
  await action.locator('summary').click();
  await expect(action).toContainText('旧参数');
  await expect(action).toContainText('POST');
  await expect(action).toContainText('null');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel).toContainText('这一条消息仍可阅读。');
  await panel.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '有什么可以帮你？' })).toBeVisible();
});

test('一张历史确认卡片报错，可切换会话并在原处重试', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [{ type: 'text', text: '另一个对话正常。' }]);
  await page.goto(`/?projectId=${project.id}`);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await input.fill('正常对话');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('home-messages')).toContainText('另一个对话正常。');
  const healthy = new URL(page.url()).searchParams.get('conversation');
  await page.getByRole('link', { name: '新对话', exact: true }).click();

  await queueAssistantTurn(request, [
    appTool('projects_update', { id: project.id, checkCommand: 'npm test' }),
    { type: 'text', text: '请核对这个修改。' },
  ]);
  await input.fill('检查修改');
  await input.press('ControlOrMeta+Enter');
  const stream = page.getByTestId('home-messages');
  await expect(stream.getByTestId('confirmation-card')).toBeVisible();
  const affected = new URL(page.url()).searchParams.get('conversation');
  const confirmations = `**/assistant/conversations/${affected}/confirmations`;
  // 旧版本留下的卡片仍符合 API 契约，但当前版本无法渲染其操作。
  await page.route(confirmations, async (route) => {
    const response = await route.fetch();
    const { items } = await response.json();
    await route.fulfill({
      json: { items: items.map((item: object) => ({ ...item, operationId: 'removed.operation' })) },
    });
  });
  await page.reload();
  await expect(stream.getByRole('alert')).toContainText('这条消息暂时无法显示');
  await expect(stream).toContainText('请核对这个修改。');
  await page.getByRole('button', { name: '切换对话' }).click();
  await page.getByTestId(`conversation-${healthy}`).click();
  await expect(stream).toContainText('另一个对话正常。');
  await page.getByRole('button', { name: '切换对话' }).click();
  await page.getByTestId(`conversation-${affected}`).click();
  await expect(stream.getByRole('alert')).toBeVisible();
  await page.unroute(confirmations);
  await stream.getByRole('button', { name: '重试' }).click();
  await expect(stream.getByTestId('confirmation-card')).toBeVisible();
  await expect(stream.getByRole('alert')).toHaveCount(0);
});

test('打开会话时整页加载失败，恢复后可直接返回主页', async ({ page, request }) => {
  await createProject(request, null);
  const settings = '**/api/v1/settings';
  await page.route(settings, (route) => route.abort('failed'));
  await page.goto('/?conversation=unavailable');
  await expect(page.getByRole('alert')).toBeVisible();
  const documentStart = await page.evaluate(() => performance.timeOrigin);
  await page.unroute(settings);
  await page.getByRole('link', { name: '返回主页' }).click({ timeout: 5000 });
  await expect(page.getByRole('textbox', { name: '告诉助手，或开始任务' })).toBeVisible();
  await expect(page.getByRole('link', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
});
