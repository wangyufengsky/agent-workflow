import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_IDS, type ThemeId, UiMode } from '@aw/shared';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, passReview, patchSettings, queueTurn, submitResult } from './helpers.ts';
import { fullHeight, inspectPage, type PageReport, WALKTHROUGH_DIR } from './walkthrough.ts';

// J9 (07 §5) and the M6-01 walkthrough: every page in both modes and all four themes opens without errors, has no
// contrast or horizontal-overflow problems at 1280 wide, and is screenshotted for manual review (no pixel assertions).

const WIDTH = 1280;
const HEIGHT = 800;

type Task = { id: string; status: string; nodes: { id: string; key: string; status: string }[] };
type Seed = {
  project: E2EProject;
  running: Task;
  question: Task;
  planReview: Task;
  failed: Task;
  review: Task;
  completed: Task;
  /** Keys of the copied workflows (unique per seed, so the spec can run again against the same backend). */
  fixedKey: string;
  aiKey: string;
};

async function api<T>(request: APIRequestContext, method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await request.fetch(`${API_BASE}${path}`, { method, headers: AUTH, ...(data && { data }) });
  if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function startWorkflow(
  request: APIRequestContext,
  project: E2EProject,
  workflowKey: string,
  requirement: string,
  confirmPlan = false,
): Promise<string> {
  const workflows = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  const workflow = workflows.items.find((w) => w.key === workflowKey);
  if (workflow === undefined) throw new Error(`workflow ${workflowKey} not found`);
  const task = await api<Task>(request, 'POST', '/tasks', {
    projectId: project.id,
    workflowId: workflow.id,
    requirement,
    checkpoints: { confirm_plan: confirmPlan },
  });
  return task.id;
}

async function waitForStatus(request: APIRequestContext, id: string, status: string): Promise<Task> {
  await expect
    .poll(async () => (await api<Task>(request, 'GET', `/tasks/${id}`)).status, { timeout: 20_000 })
    .toBe(status);
  return api<Task>(request, 'GET', `/tasks/${id}`);
}

/** One task per state the task page renders differently (14 §3.3), each in its own project so scripts stay apart. */
async function seed(request: APIRequestContext): Promise<Seed> {
  const fixScripts = async (project: E2EProject, file: string) => {
    await queueTurn(request, project, { title: '定位根因' }, [
      submitResult('找到了根因：时区换算用了服务器本地时区。'),
    ]);
    await queueTurn(request, project, { title: '修复' }, [
      { type: 'edit', file, content: 'export const toLocal = (t: number) => new Date(t).toISOString();\n' },
      submitResult('统一按 UTC 换算，并补充了 `toLocal` 的说明。'),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  };

  const reviewProject = await createProject(request, 'true');
  await fixScripts(reviewProject, 'src/time.ts');
  const review = await startWorkflow(request, reviewProject, 'bugfix', '订单时间显示错了\n下单时间比实际早 8 小时。');

  const completedProject = await createProject(request, 'true');
  await fixScripts(completedProject, 'src/refund.ts');
  const completed = await startWorkflow(request, completedProject, 'bugfix', '退款时间显示错了');

  const runningProject = await createProject(request, null);
  await queueTurn(request, runningProject, { title: '定位根因' }, [{ type: 'hang' }]);
  const running = await startWorkflow(request, runningProject, 'bugfix', '导出的报表缺少最后一行');

  const questionProject = await createProject(request, null);
  await queueTurn(request, questionProject, { title: '定位根因' }, [
    {
      type: 'callTool',
      name: 'ask_user',
      args: { question: '问题出现在哪个环境？', options: ['预发', '生产'], blocking: true },
    },
  ]);
  const question = await startWorkflow(request, questionProject, 'bugfix', '优惠券在某个环境下无法使用');

  const planProject = await createProject(request, null);
  await queueTurn(request, planProject, { agent: 'aw-planner' }, [
    {
      type: 'callTool',
      name: 'submit_plan',
      args: {
        summary: '先补接口，再做页面，最后整体验证。',
        assumptions: ['导出格式为 CSV'],
        nodes: [
          { key: 'api', title: '实现分页接口', role: 'developer', instructions: '新增分页查询接口' },
          { key: 'ui', title: '列表页分页与导出', role: 'developer', instructions: '页面接入', depends_on: ['api'] },
          { key: 'final_verify', title: '整体验证', role: 'tester', instructions: '验证', depends_on: ['ui'] },
        ],
      },
    },
  ]);
  const planReview = await startWorkflow(request, planProject, 'feature', '退款单分页查询与导出', true);

  // No turns queued: every attempt ends without a result until the step's budget runs out.
  const failedProject = await createProject(request, null);
  const failed = await startWorkflow(request, failedProject, 'bugfix', '支付回调偶发超时');

  // Custom definitions open in the editors; a connection fills the databases page.
  const run = reviewProject.slug.replace(/[^a-z0-9]/g, '_').slice(-6);
  const fixedKey = `walk_bugfix_${run}`;
  const aiKey = `walk_feature_${run}`;
  const workflows = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  for (const [from, key, name] of [
    ['bugfix', fixedKey, '我的修 Bug'],
    ['feature', aiKey, '我的新功能开发'],
  ] as const) {
    const copyFrom = workflows.items.find((w) => w.key === from)?.id;
    await api(request, 'POST', '/workflows', { key, name, copyFrom });
  }
  await api(request, 'POST', '/db-connections', {
    name: `shop_${run}`,
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'shop',
    username: 'reader',
    password: '',
    tls: false,
  });

  const completedReview = await waitForStatus(request, completed, 'review');
  await api(request, 'POST', `/tasks/${completedReview.id}/deliver`, { strategy: 'squash' });
  return {
    project: reviewProject,
    running: await waitForStatus(request, running, 'running'),
    question: await waitForStatus(request, question, 'running'),
    planReview: await waitForStatus(request, planReview, 'plan_review'),
    failed: await waitForStatus(request, failed, 'failed'),
    review: await waitForStatus(request, review, 'review'),
    completed: await waitForStatus(request, completed, 'completed'),
    fixedKey,
    aiKey,
  };
}

type Shot = {
  name: string;
  mode: UiMode;
  url: (s: Seed) => string;
  /** Visible once the page has its content. */
  ready: (page: Page) => Locator;
  /** Opens a dialog, drawer or editor before the screenshot. */
  open?: (page: Page) => Promise<Locator>;
};

const node = (task: Task, key: string) => {
  const found = task.nodes.find((n) => n.key === key);
  if (found === undefined) throw new Error(`node ${key} not found`);
  return found.id;
};
const heading = (name: string | RegExp) => (page: Page) => page.getByRole('heading', { name, level: 1 }).first();
const testId = (id: string) => (page: Page) => page.getByTestId(id).first();

const SHOTS: Shot[] = [
  { name: 'onboarding', mode: UiMode.Simple, url: () => '/onboarding', ready: testId('check-Git') },
  {
    name: 'home',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}`,
    ready: heading('今天想让 AI 做什么？'),
  },
  {
    name: 'palette',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}`,
    ready: heading('今天想让 AI 做什么？'),
    open: async (page) => {
      await page.keyboard.press('ControlOrMeta+k');
      return page.getByRole('dialog', { name: '命令面板' });
    },
  },
  { name: 'tasks', mode: UiMode.Simple, url: () => '/tasks', ready: (page) => page.getByRole('table') },
  { name: 'task-running', mode: UiMode.Simple, url: (s) => `/tasks/${s.running.id}`, ready: testId('progress-canvas') },
  {
    name: 'task-running-drawer',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.running.id}?node=${node(s.running, 'locate')}&open=true`,
    ready: testId('progress-canvas'),
    open: async (page) => page.getByRole('dialog'),
  },
  {
    name: 'task-question',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.question.id}`,
    ready: testId('progress-canvas'),
  },
  {
    name: 'inbox-drawer',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.question.id}`,
    ready: testId('progress-canvas'),
    open: async (page) => {
      await page.getByRole('button', { name: /需要你处理（\d+）/ }).click();
      return page.getByRole('dialog', { name: '需要你处理' });
    },
  },
  {
    name: 'task-plan-review',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.planReview.id}`,
    ready: (page) => page.getByRole('button', { name: '确认并开始' }),
  },
  { name: 'task-failed', mode: UiMode.Simple, url: (s) => `/tasks/${s.failed.id}`, ready: testId('failure-panel') },
  { name: 'task-review', mode: UiMode.Simple, url: (s) => `/tasks/${s.review.id}`, ready: testId('result-card') },
  {
    name: 'task-review-changes',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}`,
    ready: testId('result-card'),
    open: async (page) => {
      await page.getByTestId('result-card').getByRole('button', { name: '查看改动' }).click();
      const dialog = page.getByRole('dialog', { name: '改动' });
      await expect(dialog.getByTestId('diff-view')).toBeVisible();
      return dialog;
    },
  },
  {
    name: 'task-completed',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.completed.id}`,
    ready: testId('delivery-outcome'),
  },
  {
    name: 'node-page',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}/nodes/${node(s.review, 'fix')}`,
    ready: testId('node-page'),
  },
  { name: 'inbox', mode: UiMode.Simple, url: () => '/inbox', ready: testId('inbox-question') },
  { name: 'projects', mode: UiMode.Simple, url: () => '/projects', ready: heading('项目') },
  { name: 'project', mode: UiMode.Simple, url: (s) => `/projects/${s.project.id}`, ready: heading(/.+/) },
  { name: 'settings', mode: UiMode.Simple, url: () => '/settings', ready: heading('设置') },
  {
    name: 'pro-only',
    mode: UiMode.Simple,
    url: () => '/workflows',
    ready: (page) => page.getByText('此页面属于专业模式'),
  },
  {
    name: 'pro-home',
    mode: UiMode.Pro,
    url: (s) => `/?projectId=${s.project.id}`,
    ready: heading('今天想让 AI 做什么？'),
    open: async (page) => {
      await page.getByText('更多选项').click();
      return page.getByLabel('标题');
    },
  },
  {
    name: 'pro-task-running',
    mode: UiMode.Pro,
    url: (s) => `/tasks/${s.running.id}`,
    ready: testId('progress-canvas'),
  },
  {
    name: 'pro-task-plan-edit',
    mode: UiMode.Pro,
    url: (s) => `/tasks/${s.planReview.id}`,
    ready: (page) => page.getByRole('button', { name: '编辑计划' }),
    open: async (page) => {
      await page.getByRole('button', { name: '编辑计划' }).click();
      return page.getByTestId('plan-editor');
    },
  },
  { name: 'pro-task-review', mode: UiMode.Pro, url: (s) => `/tasks/${s.review.id}`, ready: testId('result-card') },
  {
    name: 'pro-node-page',
    mode: UiMode.Pro,
    url: (s) => `/tasks/${s.review.id}/nodes/${node(s.review, 'fix')}`,
    ready: testId('transcript'),
  },
  { name: 'pro-project', mode: UiMode.Pro, url: (s) => `/projects/${s.project.id}`, ready: heading(/.+/) },
  { name: 'pro-settings', mode: UiMode.Pro, url: () => '/settings', ready: (page) => page.getByText('专业设置') },
  { name: 'pro-git', mode: UiMode.Pro, url: () => '/git', ready: heading('Git 管理台') },
  ...(['branches', 'commits', 'files', 'worktrees'] as const).map(
    (tab): Shot => ({
      name: `pro-git-${tab}`,
      mode: UiMode.Pro,
      url: (s) => `/git/${s.project.id}?tab=${tab}`,
      ready: testId('git-status'),
    }),
  ),
  {
    name: 'pro-workflows',
    mode: UiMode.Pro,
    url: () => '/workflows',
    ready: (page) => page.getByRole('article').first(),
  },
  { name: 'pro-workflow-builtin', mode: UiMode.Pro, url: () => '/workflows/bugfix', ready: testId('progress-canvas') },
  {
    name: 'pro-workflow-fixed',
    mode: UiMode.Pro,
    url: (s) => `/workflows/${s.fixedKey}`,
    ready: testId('plan-editor'),
  },
  {
    name: 'pro-workflow-ai',
    mode: UiMode.Pro,
    url: (s) => `/workflows/${s.aiKey}`,
    ready: heading('我的新功能开发'),
  },
  { name: 'pro-roles', mode: UiMode.Pro, url: () => '/roles', ready: (page) => page.getByRole('article').first() },
  { name: 'pro-databases', mode: UiMode.Pro, url: () => '/databases', ready: heading('数据库') },
  { name: 'pro-tools', mode: UiMode.Pro, url: () => '/tools', ready: heading('MCP 工具') },
  { name: 'pro-runtime', mode: UiMode.Pro, url: () => '/runtime', ready: testId('runtime-details') },
];

test.use({ viewport: { width: WIDTH, height: HEIGHT } });
test.afterAll(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

test('J9 走查：四套主题 × 两种模式下全部页面无报错、无对比度与横向溢出问题', async ({ page, request }) => {
  test.setTimeout(900_000);
  const s = await seed(request);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  for (const theme of THEME_IDS) {
    await test.step(theme, async () => {
      const dir = join(WALKTHROUGH_DIR, theme);
      mkdirSync(dir, { recursive: true });
      const reports: Record<string, PageReport> = {};
      for (const shot of SHOTS) {
        await patchSettings(request, { 'ui.theme': theme satisfies ThemeId, 'ui.mode': shot.mode });
        await page.setViewportSize({ width: WIDTH, height: HEIGHT });
        await page.goto(shot.url(s));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(shot.ready(page)).toBeVisible();
        await expect(page.getByText('正在加载…')).toHaveCount(0);
        if (shot.open !== undefined) await expect(await shot.open(page)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        // Pages render failures through ErrorState, the only role="alert" element.
        await expect.soft(page.getByRole('alert'), `${theme} ${shot.name}`).toHaveCount(0);
        reports[shot.name] = await inspectPage(page);

        await fullHeight(page, WIDTH, HEIGHT);
        await page.screenshot({ path: join(dir, `${shot.name}.png`), animations: 'disabled' });
      }
      writeFileSync(join(dir, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
      const problems = Object.entries(reports)
        .filter(([, r]) => r.contrast.length > 0 || r.overflow.length > 0)
        .map(([name, r]) => [name, [...r.contrast, ...r.overflow]]);
      expect.soft(Object.fromEntries(problems), theme).toEqual({});
    });
  }
  expect(pageErrors).toEqual([]);
  await api(request, 'POST', `/tasks/${s.running.id}/cancel`);
});
