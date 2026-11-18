import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboxKind, taskDetailSchema } from '@aw/shared';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  passReview,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';
import { inspectPage, WALKTHROUGH_DIR } from './walkthrough.ts';

async function start(request: APIRequestContext, projectId: string, workflow: string, requirement: string) {
  const response = await request.get(`${API_BASE}/workflows`, { headers: AUTH });
  const { items } = await response.json();
  const selected = items.find((item: { key: string }) => item.key === workflow);
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId, workflowId: selected.id, requirement, start: true },
  });
  await expect(created).toBeOK();
  const task = await created.json();
  return `/tasks/${task.id}`;
}

async function advanceDocument(request: APIRequestContext, path: string) {
  const response = await request.get(API_BASE + path, { headers: AUTH });
  const permission = taskDetailSchema
    .parse(await response.json())
    .openInbox.find((i) => i.kind === InboxKind.Permission);
  if (!permission) throw new Error('Missing permission');
  await expect(
    await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
      headers: AUTH,
      data: { response: { decision: 'once' } },
    }),
  ).toBeOK();
}

const documents = [
  {
    workflow: 'detailed_design',
    survey: '梳理现状',
    write: '编写详细设计',
    path: 'docs/design/orders.md',
    before: '# 订单更新接口\n\n只有管理员可以更新订单。\n',
    after: '# 订单更新接口\n\n管理员和订单负责人可以更新订单。\n',
    anchor: '标注第 3 行',
    prior: '只有管理员可以更新订单。',
    current: '管理员和订单负责人可以更新订单。',
  },
  {
    workflow: 'breakdown',
    survey: '梳理需求与现状',
    write: '编写拆解文档',
    path: 'docs/plans/orders.md',
    before: '# 订单开发计划\n\n| 工作包 | 覆盖需求 |\n| --- | --- |\n| W-1 | 更新订单接口 |\n',
    after: '# 订单开发计划\n\n| 工作包 | 覆盖需求 |\n| --- | --- |\n| W-1 | 更新接口与权限校验 |\n',
    anchor: '标注第 5 行',
    prior: '更新订单接口',
    current: '更新接口与权限校验',
  },
] as const;

test('详细设计首版分段写入时即显示 Markdown 正文，追加可跟随，提交后才进入版本历史', async ({ page, request }) => {
  const project = await createProject(request, null);
  const file = 'docs/design/detailed-design.md';
  const initial = ['# 接口详细设计', ...Array.from({ length: 55 }, (_, i) => `第 ${i + 1} 个模块说明。`)].join('\n\n');
  await queueTurn(request, project, { title: '· 梳理现状' }, [submitResult('已梳理')]);
  await queueTurn(request, project, { title: '· 编写详细设计' }, [
    { type: 'edit', file, content: initial },
    { type: 'permission', permission: 'bash', patterns: ['node continue-design.mjs'] },
    { type: 'edit', file, content: initial + '\n\n## 状态迁移验证\n\n仅允许有效迁移。\n' },
    { type: 'permission', permission: 'bash', patterns: ['node submit-design.mjs'] },
    submitResult('文档已完成'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  const path = await start(request, project.id, 'detailed_design', '分段编写接口详细设计');
  const detail = async () =>
    taskDetailSchema.parse(await (await request.get(API_BASE + path, { headers: AUTH })).json());
  try {
    await page.goto(path);
    const draft = page.getByRole('region', { name: '工作区草稿' });
    await expect(draft.getByRole('heading', { name: '接口详细设计' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
    await expect(page.getByTestId('artifact-workbench')).toContainText(file);
    expect((await detail()).artifact?.versions).toHaveLength(0);
    await page.reload();
    await expect(draft.getByRole('heading', { name: '接口详细设计' })).toBeVisible();
    await page.getByRole('button', { name: '跟随编辑', exact: true }).click();
    await advanceDocument(request, path);
    const appended = draft.getByRole('heading', { name: '状态迁移验证' });
    await expect(appended).toBeAttached({ timeout: TASK_RUN_TIMEOUT_MS });
    await expect(appended).not.toBeInViewport();
    await page.getByRole('button', { name: '继续跟随编辑', exact: true }).click();
    await expect(draft.getByRole('heading', { name: '状态迁移验证' })).toBeInViewport({ timeout: TASK_RUN_TIMEOUT_MS });
    expect(await draft.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    if (process.env.AW_WALKTHROUGH_DIR !== undefined)
      await page.screenshot({ animations: 'disabled', path: join(WALKTHROUGH_DIR, 'document-draft.png') });
    expect((await detail()).artifact?.versions).toHaveLength(0);
    await advanceDocument(request, path);
    await expect(page.getByRole('region', { name: '产物预览 v1' }).getByText('仅允许有效迁移。')).toBeVisible({
      timeout: TASK_RUN_TIMEOUT_MS,
    });
    await expect(draft).toHaveCount(0);
    expect((await detail()).artifact?.versions).toHaveLength(1);
  } finally {
    const task = await detail();
    if (task.activeAttempts.length) await request.post(API_BASE + path + '/cancel', { headers: AUTH, data: {} });
  }
});

for (const item of documents) {
  test(`${item.write}在工作台标注、对照并合并仓库文件`, async ({ page, request }) => {
    if (GIT_HEAVY_SPECS_SLOW) test.slow();
    await patchSettings(request, { 'ui.mode': 'simple', 'ui.theme': 'codex' });
    const project = await createProject(request, null);
    await queueTurn(request, project, { title: `· ${item.survey}` }, [submitResult('已梳理现状')]);
    await queueTurn(request, project, { title: `· ${item.write}` }, [
      { type: 'edit', file: item.path, content: item.before },
      submitResult('首版已完成'),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
    await queueTurn(request, project, { title: '· 产物修改 1' }, [
      { type: 'edit', file: item.path, content: item.after },
      { type: 'permission', permission: 'bash', patterns: ['node submit-revision.mjs'] },
      submitResult('已修改文档'),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
    const path = await start(request, project.id, item.workflow, item.write);
    await page.goto(path);
    const workbench = page.getByTestId('artifact-workbench');
    await expect(workbench.getByText(item.path, { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS * 2 });
    await workbench.getByRole('button', { name: '标注修改' }).click();
    await workbench.getByRole('button', { name: item.anchor, exact: true }).click();
    await workbench.getByLabel('怎么修改').fill('补上订单负责人的权限校验。');
    const viewport = await inspectPage(page);
    expect(viewport.contrast).toEqual([]);
    expect(viewport.overflow).toEqual([]);
    if (process.env.AW_WALKTHROUGH_DIR !== undefined)
      await page.screenshot({ animations: 'disabled', path: join(WALKTHROUGH_DIR, `${item.workflow}.png`) });
    await workbench.getByRole('button', { name: '加入本轮' }).click();
    await workbench.getByRole('button', { name: '交给 AI 修改' }).click();
    const draft = workbench.getByRole('region', { name: '工作区草稿' });
    await expect(draft.getByText(item.current, { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS * 2 });
    const liveTask = taskDetailSchema.parse(await (await request.get(API_BASE + path, { headers: AUTH })).json());
    expect(liveTask.artifact?.versions).toHaveLength(1);
    await advanceDocument(request, path);
    await expect(workbench.getByRole('region', { name: '产物预览 v2' })).toBeVisible({
      timeout: TASK_RUN_TIMEOUT_MS * 2,
    });
    await workbench.getByRole('button', { name: '版本记录' }).click();
    await workbench.getByRole('button', { name: '对照上一版' }).click();
    await expect(
      workbench.getByRole('region', { name: '改前 v1' }).getByText(item.prior, { exact: true }),
    ).toBeVisible();
    await expect(
      workbench.getByRole('region', { name: '产物预览 v2' }).getByText(item.current, { exact: true }),
    ).toBeVisible();
    await workbench.getByRole('button', { name: '验收并交付' }).click();
    await page.getByRole('dialog', { name: '验收并交付' }).getByRole('button', { name: '合并到 main' }).click();
    await expect
      .poll(
        async () => {
          const result = await request.get(`${API_BASE}${new URL(page.url()).pathname}`, { headers: AUTH });
          return (await result.json()).status;
        },
        { timeout: TASK_RUN_TIMEOUT_MS },
      )
      .toBe('completed');
    expect(git(project.repoPath, 'show', `main:${item.path}`)).toBe(item.after.trim());
    await page.reload();
    await expect(page.getByTestId('delivery-outcome')).toContainText('已合并到 main');
    await expect(workbench.getByText(item.current, { exact: true })).toBeVisible();
  });
}

test('代码审查在主区按严重程度筛选，定位到审查时的文件，并完成只读报告', async ({ page, request }) => {
  if (GIT_HEAVY_SPECS_SLOW) test.slow();
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': 'default' });
  const project = await createProject(request, null);
  const file = 'access.ts';
  writeFileSync(join(project.repoPath, file), 'export const updateAllowed = true;\nexport const testCoverage = 0;\n');
  git(project.repoPath, 'add', file);
  git(project.repoPath, 'commit', '-m', 'add access rules');
  const commit = git(project.repoPath, 'rev-parse', 'HEAD');
  await queueTurn(request, project, { title: '· 代码审查' }, [
    {
      type: 'callTool',
      name: 'submit_result',
      args: {
        summary: '更新订单缺少权限校验。',
        code_review: {
          scope: { kind: 'files', commit, directory: '' },
          findings: [
            {
              path: file,
              line: 1,
              severity: 'blocker',
              category: 'security',
              title: '更新接口未检查权限',
              description: '非订单负责人也可发起更新。',
              suggestion: '验证角色与订单归属。',
            },
            {
              path: file,
              line: 2,
              severity: 'minor',
              category: 'tests',
              title: '缺少权限回归用例',
              description: '补一条回归用例。',
            },
          ],
        },
      },
    },
  ]);
  await page.goto(await start(request, project.id, 'code_review', '检查订单更新接口'));
  const review = page.getByTestId('task-code-review');
  await expect(review.getByRole('heading', { name: '问题清单' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS * 2 });
  await review.getByRole('button', { name: '阻断 1' }).click();
  await expect(review.getByRole('heading', { name: '缺少权限回归用例' })).toHaveCount(0);
  writeFileSync(join(project.repoPath, file), 'export const updateAllowed = false;\n');
  git(project.repoPath, 'commit', '-am', 'change working branch after review');
  await review.getByRole('button', { name: 'access.ts:1' }).click();
  const code = review.getByRole('complementary', { name: '代码位置' });
  await expect(code.getByText('export const updateAllowed = true;', { exact: false })).toBeVisible();
  await expect(code.getByRole('link', { name: '在 Git 工作台打开' })).toHaveAttribute('href', new RegExp(commit));
  await expect(review.getByRole('heading', { name: '更新接口未检查权限' })).toBeVisible();
  const wide = await inspectPage(page);
  expect(wide.contrast).toEqual([]);
  expect(wide.overflow).toEqual([]);
  if (process.env.AW_WALKTHROUGH_DIR !== undefined)
    await page.screenshot({ animations: 'disabled', path: join(WALKTHROUGH_DIR, 'code-review.png') });
  await page.setViewportSize({ width: 900, height: 800 });
  expect((await inspectPage(page)).overflow).toEqual([]);
  await code.getByRole('link', { name: '在 Git 工作台打开' }).click();
  await expect(page.getByTestId('git-file').locator('mark[data-line="1"]')).toContainText('updateAllowed = true');
  await page.goBack();
  await expect(review.getByRole('heading', { name: '问题清单' })).toBeVisible();
  await queueTurn(request, project, { title: '· 按反馈修改' }, [
    {
      type: 'callTool',
      name: 'submit_result',
      args: {
        summary: '已复核并撤回旧问题。',
        code_review: { scope: { kind: 'files', commit, directory: '' }, findings: [] },
      },
    },
  ]);
  const revise = await request.post(`${API_BASE}${new URL(page.url()).pathname}/request-changes`, {
    headers: AUTH,
    data: { reason: 'user', feedback: '请复核已有问题。' },
  });
  await expect(revise).toBeOK();
  await expect(review.getByText('已复核并撤回旧问题。')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS * 2 });
  await expect(review.getByText('没有发现需要处理的问题')).toBeVisible();
  await expect(review.getByRole('heading', { name: '更新接口未检查权限' })).toHaveCount(0);
  await review.getByRole('button', { name: '完成审查' }).click();
  await expect(review.getByRole('button', { name: '完成审查' })).toHaveCount(0);
  await expect(review.getByRole('heading', { name: '问题清单' })).toBeVisible();
});
