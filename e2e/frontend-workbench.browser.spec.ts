import { InboxKind, PermissionDecision, TaskStatus, taskDetailSchema } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, queueTurn, startTask, submitResult, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

const server = `import { createServer } from 'node:http';
createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><meta name="viewport" content="width=device-width"><h1>Orders</h1>'); }).listen(Number(process.env.PORT), '127.0.0.1');
`;

test('前端开发从开始任务直接进入预览，在同一个任务提交整页修改意见', async ({ page, request }) => {
  const project = await createProject(request, null);
  await expect(
    await request.patch(`${API_BASE}/projects/${project.id}`, {
      headers: AUTH,
      data: {
        preview: { command: 'node preview.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
      },
    }),
  ).toBeOK();
  await queueTurn(request, project, { title: '开发首版页面' }, [
    { type: 'think', text: '先检查订单页的入口，再启动预览。' },
    { type: 'edit', file: 'preview.mjs', content: server },
    submitResult('首版就绪'),
  ]);
  await queueTurn(request, project, { title: '界面修改 1' }, [
    { type: 'permission', permission: 'bash', patterns: ['node verify-page.mjs'] },
    submitResult('修改完成'),
  ]);
  await startTask(page, project, /^前端开发$/, '在预览中开发订单页');
  const workbench = page.getByTestId('frontend-workbench');
  await expect(page.getByRole('tab', { name: '网页预览' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '流程画布' }).click();
  await expect(page.getByTestId('progress-canvas')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await page.getByRole('tab', { name: '网页预览' }).click();
  await expect(workbench).toBeVisible();
  await expect(page.getByText('待查看页面', { exact: true })).toBeVisible({ timeout: 2 * TASK_RUN_TIMEOUT_MS });
  await expect(workbench.getByRole('button', { name: '完成并验收' })).toBeEnabled();
  await workbench.getByRole('button', { name: '标注修改' }).click();
  await workbench.getByRole('textbox', { name: '补充这轮的整体要求' }).fill('页面标题改为订单明细');
  const taskPath = new URL(page.url()).pathname;
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(`**/api/v1${taskPath}/request-changes`, async (route) => {
    // Hold the response until the completion event has already reached the open task page.
    const response = await route.fetch();
    expect(taskDetailSchema.parse(await response.json()).status).toBe(TaskStatus.Running);
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await workbench.getByRole('button', { name: '交给 AI 修改' }).click();
    await held.promise;
    const pendingPermission = async () => {
      const response = await request.get(`${API_BASE}${taskPath}`, { headers: AUTH });
      return taskDetailSchema.parse(await response.json()).openInbox.find((item) => item.kind === InboxKind.Permission);
    };
    await expect.poll(pendingPermission).toBeDefined();
    const permission = await pendingPermission();
    if (permission === undefined) throw new Error('The revision is not waiting for permission');
    await expect(
      await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
        headers: AUTH,
        data: { response: { decision: PermissionDecision.Once } },
      }),
    ).toBeOK();
    await expect(page.getByText('待查看页面', { exact: true })).toBeVisible({ timeout: 2 * TASK_RUN_TIMEOUT_MS });
  } finally {
    release.resolve();
  }
  // 完成修改后直接显示活动。可从这里回看首版执行记录，完整流程在第二个页签。
  const activity = workbench.getByRole('region', { name: 'AI 活动' });
  await expect(activity).toBeVisible();
  await expect(workbench.getByTestId('progress-canvas')).toHaveCount(0);
  await activity.getByRole('combobox', { name: '活动步骤' }).selectOption({ label: '开发首版页面' });
  await expect(activity.getByTestId('stream-thinking')).toContainText('先检查订单页的入口');

  await expect(workbench.getByRole('button', { name: '界面修改 1' })).toBeVisible();
  await expect(page.getByText('待查看页面', { exact: true })).toBeVisible();
  await expect(workbench.getByRole('button', { name: '完成并验收' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(taskPath);
  const response = await request.get(`${API_BASE}${taskPath}`, { headers: AUTH });
  await expect(response).toBeOK();
  const task = taskDetailSchema.parse(await response.json());
  expect(task.frontend?.rounds).toMatchObject([{ feedback: '页面标题改为订单明细', annotations: [] }]);
  for (const title of ['开发首版页面', '界面修改 1']) {
    expect(task.plan?.graph.nodes.find((node) => node.title === title)?.instructions).toContain(
      'aw-frontend-development',
    );
  }
  const needsReview = await request.get(`${API_BASE}/tasks?displayGroup=frontend_review&projectId=${project.id}`, {
    headers: AUTH,
  });
  await expect(needsReview).toBeOK();
  expect((await needsReview.json()).items).toEqual([expect.objectContaining({ id: task.id })]);
  const toMerge = await request.get(`${API_BASE}/tasks?displayGroup=review&projectId=${project.id}`, { headers: AUTH });
  await expect(toMerge).toBeOK();
  expect((await toMerge.json()).items).toEqual([]);
  const original = task.nodes.find((node) => node.title === '开发首版页面');
  if (!original) throw new Error('Missing first implementation step');
  const toggle = activity.getByRole('button', { name: /开发首版页面/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await activity.getByRole('link', { name: '完整详情' }).click();
  await expect(page).toHaveURL(new RegExp(`/nodes/${original.id}\\?attempt=`));
  await expect(page.getByRole('tab', { name: '过程' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('stream-thinking')).toContainText('先检查订单页的入口');
});

test('前端验收跟随首版新增文件和实际手机页面，退出跟随可继续浏览自己的预览', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  await expect(
    await request.patch(`${API_BASE}/projects/${project.id}`, {
      headers: AUTH,
      data: {
        preview: { command: 'node preview.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
      },
    }),
  ).toBeOK();
  const file = 'web/src/pages/TransformerArticle.vue';
  await queueTurn(request, project, { title: '开发首版页面' }, [
    { type: 'edit', file: 'preview.mjs', content: server },
    { type: 'edit', file, content: '<template>\nTransformer\n</template>\n' },
    submitResult('首版就绪'),
  ]);
  await queueTurn(request, project, { title: '前端交付验收' }, [
    { type: 'tool', tool: 'read', input: { filePath: file, offset: 2 }, output: '<content>2: Transformer</content>' },
    { type: 'permission', permission: 'bash', patterns: ['node check-page.mjs'] },
    { type: 'callTool', name: 'browser_open', args: { url: '/transformer#why' } },
    { type: 'callTool', name: 'browser_viewport', args: { preset: 'mobile' } },
    { type: 'hang' },
  ]);
  await startTask(page, project, /^前端开发$/, '核验介绍页');
  const path = new URL(page.url()).pathname;
  try {
    await page.getByRole('button', { name: '完成并验收' }).click();
    await page.getByRole('button', { name: '跟随 AI 阅读', exact: true }).click();
    await expect(page.getByRole('region', { name: '项目文件阅读' }).locator('mark')).toHaveText('2: Transformer');
    const detail = taskDetailSchema.parse(await (await request.get(API_BASE + path, { headers: AUTH })).json());
    const permission = detail.openInbox.find((i) => i.kind === InboxKind.Permission);
    if (!permission) throw new Error('Missing verification permission');
    await expect(
      await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
        headers: AUTH,
        data: { response: { decision: PermissionDecision.Once } },
      }),
    ).toBeOK();
    const screen = page.getByRole('region', { name: 'AI 网页画面' });
    await expect(screen).toContainText('/transformer#why');
    await expect.poll(() => screen.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(390);
    await page.screenshot({ path: info.outputPath('verification-mobile.png') });
    await page.getByRole('tab', { name: '流程画布' }).click();
    await expect(screen).toBeHidden();
    await page.getByRole('tab', { name: '网页预览' }).click();
    await expect(screen).toBeVisible();
    await page.getByRole('button', { name: '暂停跟随阅读' }).click();
    await expect(screen).toBeHidden();
    await expect(page.getByTestId('frontend-workbench').getByText('页面只在桌面版中显示。')).toBeVisible();
  } finally {
    await request.post(`${API_BASE}${path}/cancel`, { headers: AUTH, data: {} });
  }
});
