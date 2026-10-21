import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn, queueTurn } from './helpers.ts';

// J11 and the panel smoke (A-06–A-08): the assistant's turns are played by FakeOpencode through the assistant MCP.
// The file name sorts after onboarding.browser.spec.ts, which needs the shared backend without any project.

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple', 'assistant.alwaysAllow': [] }),
);

test('J11 对助手说开始任务 → 确认卡片 → 任务运行', async ({ page, request }) => {
  const project = await createProject(request, null);
  const workflows: { items: { id: string; key: string }[] } = await (
    await request.get(`${API_BASE}/workflows`, { headers: AUTH })
  ).json();
  const bugfix = workflows.items.find((w) => w.key === 'bugfix');
  if (bugfix === undefined) throw new Error('no bugfix workflow');
  await queueAssistantTurn(request, [
    appTool('tasks_create', {
      projectId: project.id,
      workflowId: bugfix.id,
      requirement: '助手开的任务：退款金额少算了运费',
    }),
    { type: 'text', text: '我准备开始一个修 Bug 任务，请在卡片上确认。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '任务已经开始了。' }]);
  // The task's first step keeps working, so the task stays running.
  await queueTurn(request, project, { title: '定位根因' }, [{ type: 'hang' }]);

  await page.goto(`/?projectId=${project.id}`);
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await panel.getByLabel('发给助手的消息').fill('帮我修一下：助手开的任务：退款金额少算了运费');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  await expect(panel.getByTestId('assistant-user-message')).toHaveText('帮我修一下：助手开的任务：退款金额少算了运费');

  const card = panel.getByTestId('confirmation-card');
  await expect(card).toContainText('开始任务');
  await expect(card).toContainText('助手开的任务：退款金额少算了运费');
  await expect(card).toContainText('等待确认');
  await card.getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toContainText('已执行');
  await expect(panel).toContainText('任务已经开始了。');

  // The link's name carries the open-item count when earlier specs left some.
  await page.getByRole('navigation').getByRole('link', { name: /^任务/ }).click();
  await expect(page.getByRole('row').filter({ hasText: '助手开的任务：退款金额少算了运费' })).toContainText('执行中');
  await expect(panel).toBeVisible();
});

test('主页输入交给助手；open_page 在面板旁跳转；卡片上「总是允许」后可在设置中撤销', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [appTool('open_page', { page: 'inbox' }), { type: 'text', text: '已为你打开。' }]);
  await queueAssistantTurn(request, [
    appTool('projects_update', { id: project.id, checkCommand: 'npm test' }),
    { type: 'text', text: '请确认。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '改好了。' }]);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('textbox', { name: '问助手' }).fill('打开需要我处理的事');
  await page.getByRole('textbox', { name: '问助手' }).press('Enter');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel.getByTestId('assistant-user-message')).toHaveText('打开需要我处理的事');
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(panel).toContainText('已为你打开。');
  await expect(panel.getByRole('combobox', { name: '对话' })).toHaveValue(/.+/);

  await panel.getByLabel('发给助手的消息').fill('把检查命令设成 npm test');
  await panel.getByRole('button', { name: '发送' }).click();
  const card = panel.getByTestId('confirmation-card');
  await card.getByRole('button', { name: '确认并总是允许' }).click();
  await expect(card).toContainText('已执行');
  await expect(panel).toContainText('改好了。');

  await page.getByRole('link', { name: '设置', exact: true }).click();
  const allowed = page.getByRole('list', { name: '总是允许的操作' });
  await expect(allowed).toContainText('修改项目');
  await allowed.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('还没有总是允许的操作')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeHidden();
});
