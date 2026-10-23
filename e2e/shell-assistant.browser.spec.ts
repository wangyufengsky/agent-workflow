import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { appTool, createProject, createRepo, patchSettings, queueAssistantTurn, queueTurn } from './helpers.ts';

let hangingProjectId: string | undefined;
test.afterEach(async ({ request }) => {
  if (hangingProjectId === undefined) return;
  const projectId = hangingProjectId;
  hangingProjectId = undefined;
  // 本文件故意挂起执行以观察忙碌状态；结束后释放共享后端的调度槽位。
  const tasks = await (await request.get(`${API_BASE}/tasks?projectId=${projectId}`, { headers: AUTH })).json();
  for (const task of tasks.items) {
    const response = await request.post(`${API_BASE}/tasks/${task.id}/cancel`, { headers: AUTH, data: {} });
    expect(response.ok()).toBe(true);
  }
});

// J11 and the panel smoke (A-06–A-08): the assistant's turns are played by FakeOpencode through the assistant MCP.
// The file name sorts after onboarding.browser.spec.ts, which needs the shared backend without any project.

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple', 'assistant.alwaysAllow': [] }),
);

test('J11 对助手说开始任务 → 确认卡片 → 任务运行', async ({ page, request }) => {
  const project = await createProject(request, null);
  hangingProjectId = project.id;
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

  // Away from home: there ⌘J goes to the page's own input (D112).
  await page.goto('/settings');
  // The shell's shortcuts listen once the page has rendered.
  await expect(page.getByRole('main').getByRole('heading', { name: '设置' })).toBeVisible();
  // The panel floats over the page instead of taking a column from it (D84).
  const pageWidth = (await page.locator('main').boundingBox())?.width;
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel).toBeVisible();
  expect((await page.locator('main').boundingBox())?.width).toBe(pageWidth);
  await panel.getByLabel('发给助手的消息').fill('帮我修一下：助手开的任务：退款金额少算了运费');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  await expect(panel.getByTestId('assistant-user-message')).toHaveText('帮我修一下：助手开的任务：退款金额少算了运费');

  const card = panel.getByTestId('confirmation-card');
  await expect(card).toContainText('开始任务');
  await expect(card).toContainText('助手开的任务：退款金额少算了运费');
  await expect(card).toContainText('等待确认');
  // Parameters read in words: ids as the objects' names, fields by their labels (15 §4).
  await expect(card).toContainText(`项目${project.name}`);
  await expect(card).toContainText('流程修 Bug');
  await expect(card).not.toContainText(project.id);
  await expect(card).not.toContainText('workflowId');
  await card.getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toContainText('已执行');
  await expect(panel).toContainText('任务已经开始了。');

  // The produced task shows as a navigation card whose status follows the task (D66).
  const taskCard = panel.getByTestId('entity-card');
  await expect(taskCard).toContainText('助手开的任务：退款金额少算了运费');
  await expect(taskCard).toContainText('执行中');
  await taskCard.getByRole('button', { name: '打开' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '助手开的任务：退款金额少算了运费' })).toBeVisible();
  await expect(panel).toBeVisible();
});

test('主页的建议在主页上提问；open_page 带用户离开时面板接着显示对话；卡片上「总是允许」后可在设置中撤销', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [appTool('open_page', { page: 'inbox' }), { type: 'text', text: '已为你打开。' }]);
  await queueAssistantTurn(request, [
    appTool('projects_update', { id: project.id, checkCommand: 'npm test' }),
    { type: 'text', text: '请确认。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '改好了。' }]);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('group', { name: '试试问' }).getByRole('button', { name: '哪些事需要我处理' }).click();
  // The assistant took the user to another page: the panel shows the same conversation there (D112).
  await expect(page).toHaveURL(/\/inbox$/);
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel.getByTestId('assistant-user-message')).toHaveText('哪些事需要我处理');
  await expect(panel).toContainText('已为你打开。');
  // The call reads as what it does; its internal name stays in pro mode's details (15 §6).
  await expect(panel.getByTestId('assistant-action')).toHaveText('打开页面');

  await panel.getByLabel('发给助手的消息').fill('把检查命令设成 npm test');
  await panel.getByRole('button', { name: '发送' }).click();
  const card = panel.getByTestId('confirmation-card');
  await card.getByRole('button', { name: '确认并总是允许' }).click();
  await expect(card).toContainText('已执行');
  await expect(panel).toContainText('改好了。');

  await page.getByRole('link', { name: '设置', exact: true }).click();
  const allowed = page.getByRole('list', { name: '总是允许的操作' });
  await expect(allowed).toContainText('修改项目');
  // The panel floats over the page's right side (D84): what it covers is reached once it is closed.
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeHidden();
  await allowed.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('还没有总是允许的操作')).toBeVisible();
});

test('总是允许的调用直接执行并出现对象卡片；对象删除后卡片显示「已删除」', async ({ page, request }) => {
  await createProject(request, null);
  await patchSettings(request, { 'assistant.alwaysAllow': ['projects.create'] });
  const repoPath = createRepo();
  await queueAssistantTurn(request, [
    // A native tool may print anything, malformed JSON included: only the app's tools are read as JSON.
    { type: 'tool', tool: 'bash', input: { command: 'git status' }, output: '{ unfinished' },
    appTool('projects_create', { repoPath, name: '助手加的项目' }),
    { type: 'text', text: '项目已添加。' },
  ]);

  await page.goto('/settings');
  await expect(page.getByRole('main').getByRole('heading', { name: '设置' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await panel.getByLabel('发给助手的消息').fill('把这个仓库加成项目');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  const card = panel.getByTestId('entity-card');
  await expect(card).toContainText('助手加的项目');
  await expect(card.getByRole('button', { name: '打开' })).toBeEnabled();
  await expect(panel.getByTestId('assistant-action').filter({ hasText: '添加项目' })).toBeVisible();
  await expect(panel.getByTestId('assistant-action').filter({ hasText: '运行命令' })).toContainText('git status');
  await expect(panel).not.toContainText('projects_create');

  const projects: { items: { id: string; name: string }[] } = await (
    await request.get(`${API_BASE}/projects`, { headers: AUTH })
  ).json();
  const added = projects.items.find((p) => p.name === '助手加的项目');
  if (added === undefined) throw new Error('project not added');
  await request.delete(`${API_BASE}/projects/${added.id}`, { headers: AUTH });

  // With reduced motion the panel only fades; it still opens and closes (D84).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('main').getByRole('heading', { name: '设置' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(card).toContainText('已删除');
  await expect(card.getByRole('button', { name: '打开' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('J25 主页：让助手开始任务 → 主页上的确认卡片 → 导航卡片与工作概览 → 打开任务页，面板接着显示同一对话', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  const workflows: { items: { id: string; key: string }[] } = await (
    await request.get(`${API_BASE}/workflows`, { headers: AUTH })
  ).json();
  const bugfix = workflows.items.find((w) => w.key === 'bugfix');
  if (bugfix === undefined) throw new Error('no bugfix workflow');
  const requirement = '主页开的任务：登录页记不住密码';
  hangingProjectId = project.id;
  await queueAssistantTurn(request, [
    appTool('tasks_create', { projectId: project.id, workflowId: bugfix.id, requirement }),
    { type: 'text', text: '用修 Bug 流程来做，请在卡片上确认。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '任务已经开始了。' }]);
  await queueTurn(request, project, { title: '定位根因' }, [{ type: 'hang' }]);

  await page.goto(`/?projectId=${project.id}`);
  await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
  // On the home page ⌘J goes to the page's own input, which asks the assistant by default (D111, D112).
  await page.keyboard.press('ControlOrMeta+j');
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await expect(input).toBeFocused();
  await input.fill(`帮我修一下：${requirement}`);
  await input.press('ControlOrMeta+Enter');

  // The conversation is the page now; the panel stays closed here.
  await expect(page).toHaveURL(/[?&]conversation=/);
  const stream = page.getByTestId('home-messages');
  await expect(stream.getByTestId('assistant-user-message')).toHaveText(`帮我修一下：${requirement}`);
  await expect(page.getByRole('complementary', { name: '应用助手' })).toHaveCount(0);
  const card = stream.getByTestId('confirmation-card');
  await expect(card).toContainText('开始任务');
  await card.getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toContainText('已执行');
  await expect(stream).toContainText('任务已经开始了。');
  const taskCard = stream.getByTestId('entity-card');
  await expect(taskCard).toContainText(requirement);
  // The rail beside the conversation lists the task the assistant started.
  await expect(page.getByRole('complementary', { name: '工作概览' })).toContainText(requirement);

  await taskCard.getByRole('button', { name: '打开' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: requirement })).toBeVisible();
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel.getByTestId('assistant-user-message')).toHaveText(`帮我修一下：${requirement}`);

  // Back home with the panel open: the conversation moves onto the page and the panel closes.
  await page.getByRole('link', { name: '主页', exact: true }).click();
  await expect(page).toHaveURL(/[?&]conversation=/);
  await expect(page.getByTestId('home-messages')).toContainText('任务已经开始了。');
  await expect(panel).toHaveCount(0);
});
