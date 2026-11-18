import { InboxKind, PermissionDecision, TaskStatus, taskDetailSchema } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, queueTurn, startTask, submitResult, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

const server = `import { createServer } from 'node:http';
createServer((_request, response) => { response.end('<h1>Orders</h1>'); }).listen(Number(process.env.PORT), '127.0.0.1');
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
  // The mutation success handler closes notes and opens the task history.
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
});
