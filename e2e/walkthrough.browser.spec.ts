import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_PREFIX, THEME_IDS, type ThemeId, UiMode } from '@aw/shared';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  appTool,
  createProject,
  createRepo,
  type E2EProject,
  type FakeStep,
  git,
  passReview,
  patchSettings,
  queueAssistantTurn,
  queueCodeReviewerTurn,
  queueResearchTurn,
  queueTurn,
  queueWriterTurn,
  submitResult,
} from './helpers.ts';
import { fullHeight, inspectPage, type PageReport, WALKTHROUGH_DIR } from './walkthrough.ts';

// J9 (07 §5) and the M6-01 walkthrough: every page in both modes and all four themes opens without errors, has no
// contrast or horizontal-overflow problems at 1280 wide, and is screenshotted for manual review (no pixel assertions).

const WIDTH = 1280;
const HEIGHT = 800;

type Task = { id: string; status: string; nodes: { id: string; key: string; status: string }[] };
type Seed = {
  project: E2EProject;
  running: Task;
  /** A running task whose AI session opened a page of its preview (29 §8.1–§8.2). */
  preview: Task;
  question: Task;
  planReview: Task;
  failed: Task;
  review: Task;
  completed: Task;
  /** Keys of the copied workflows (unique per seed, so the spec can run again against the same backend). */
  fixedKey: string;
  aiKey: string;
  /** An answered knowledge question with two citations (K-09). */
  knowledge: { id: string; turnId: string };
  /** A question whose answer is still a draft: written, waiting for a permission before it is submitted (18 §5.5). */
  knowledgeDraft: string;
  /** A code-review batch of two targets: one report waiting to be finished, one still running (20 §4). */
  batch: string;
  /** A code-review schedule run once by hand (22 §7). */
  schedule: string;
  /** An assistant conversation that keeps working until the walkthrough ends. */
  assistantBusy: string;
  /** The Git workbench (27): the review project's main commit, reviewed by the AI with one finding. */
  gitCommit: string;
  /** The assistant conversation with every kind of message, shown on the home page too (D112). */
  assistantConversation: string;
  /** PPTs (23): one whose outline waits for confirmation, one made with a page in every layout. */
  deckOutline: string;
  deckMade: string;
};

/** One page in each of the ten layouts, the texts near their limits (23 §5.1). */
const DECK_PAGES = [
  { layout: 'cover', title: '订单服务退款改造', subtitle: '列表分页与导出 · 第 42 周进展汇报' },
  { layout: 'section', title: '为什么要改', subtitle: '退款单过了十万条以后，列表与导出都撑不住了' },
  {
    layout: 'bullets',
    title: '列表接口在大数据量下超时',
    bullets: ['十万条以上时列表接口要 **8 秒**', '导出只能放在凌晨跑，白天经常失败', '客服每周收到二十多次投诉'],
  },
  {
    layout: 'two_column',
    title: '改造前后对比',
    left: { heading: '改造前', bullets: ['一次查出全部数据', '导出占满数据库连接'] },
    right: { heading: '改造后', bullets: ['游标分页，每页 50 条', '导出改成后台任务'] },
  },
  {
    layout: 'cards',
    title: '三处改动',
    cards: [
      { heading: '分页查询', body: '按创建时间与编号做游标，翻页不再扫全表。' },
      { heading: '后台导出', body: '导出任务排队执行，完成后通知下载。' },
      { heading: '索引', body: '补了 (status, created_at) 复合索引。' },
    ],
  },
  {
    layout: 'steps',
    title: '上线分四步',
    steps: [
      { label: '灰度 5%', detail: '观察接口耗时' },
      { label: '灰度 50%', detail: '观察数据库负载' },
      { label: '全量', detail: '关闭旧接口' },
      { label: '复盘', detail: '一周后回顾' },
    ],
  },
  {
    layout: 'stats',
    title: '改完以后',
    stats: [
      { value: '200 ms', label: '列表接口 P95' },
      { value: '0', label: '本周导出失败' },
      { value: '-92%', label: '数据库 CPU 峰值' },
    ],
  },
  {
    layout: 'table',
    title: '接口耗时',
    columns: ['数据量', '改造前', '改造后'],
    rows: [
      ['1 万条', '0.9 秒', '0.12 秒'],
      ['10 万条', '8.1 秒', '0.18 秒'],
      ['50 万条', '超时', '0.21 秒'],
    ],
  },
  {
    layout: 'code',
    title: '游标分页的查询',
    language: 'sql',
    code: 'SELECT * FROM refunds\nWHERE (created_at, id) < (?, ?)\nORDER BY created_at DESC, id DESC\nLIMIT 50;',
    caption: '用上一页最后一条的 created_at 与 id 作为游标',
  },
  { layout: 'quote', quote: '**可以全量上线**，导出任务下周迁到独立队列。', attribution: '评审结论' },
];

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: object,
): Promise<T> {
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
  acceptEachNode = false,
): Promise<string> {
  const workflows = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  const workflow = workflows.items.find((w) => w.key === workflowKey);
  if (workflow === undefined) throw new Error(`workflow ${workflowKey} not found`);
  const task = await api<Task>(request, 'POST', '/tasks', {
    projectId: project.id,
    workflowId: workflow.id,
    requirement,
    checkpoints: { confirm_plan: confirmPlan, accept_each_node: acceptEachNode },
  });
  return task.id;
}

async function waitForStatus(request: APIRequestContext, id: string, status: string): Promise<Task> {
  await expect
    .poll(async () => (await api<Task>(request, 'GET', `/tasks/${id}`)).status, { timeout: 20_000 })
    .toBe(status);
  return api<Task>(request, 'GET', `/tasks/${id}`);
}

async function settledConversation(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => (await api<{ busy: boolean }>(request, 'GET', `/assistant/conversations/${id}`)).busy)
    .toBe(false);
}

/**
 * The assistant panel's states (15 §6, D84): a conversation with every kind of message — action rows, a navigation
 * card, an answer citing the knowledge conversation, an error, a write waiting for confirmation last — and one still
 * working. Returns the working one, aborted when the walkthrough ends.
 */
async function seedAssistant(
  request: APIRequestContext,
  project: E2EProject,
  knowledge: { id: string; turnId: string },
): Promise<{ busy: string; conversation: string }> {
  const busy = await api<{ id: string }>(request, 'POST', '/assistant/conversations', { title: '失败任务排查' });
  await queueAssistantTurn(request, [
    { type: 'tool', tool: 'read', input: { filePath: 'notes.md' } },
    { type: 'hang' },
  ]);
  await api(request, 'POST', `/assistant/conversations/${busy.id}/messages`, {
    text: '最近有哪些任务失败了？',
    context: { page: 'home', params: {} },
  });

  const conversation = await api<{ id: string }>(request, 'POST', '/assistant/conversations', { title: '项目整理' });
  const say = (text: string) =>
    api(request, 'POST', `/assistant/conversations/${conversation.id}/messages`, {
      text,
      context: { page: 'home', params: {} },
    });
  await patchSettings(request, { 'assistant.alwaysAllow': ['projects.create'] });
  await queueAssistantTurn(request, [
    appTool('projects_list', {}),
    appTool('projects_create', { repoPath: createRepo(), name: '助手加的项目' }),
    { type: 'text', text: '项目加好了，检查命令按仓库推断为 `pnpm test`。' },
  ]);
  await say('看看我有哪些项目，再把这个仓库加进来');
  await settledConversation(request, conversation.id);
  await patchSettings(request, { 'assistant.alwaysAllow': [] });

  const cite = (index: number) => `/knowledge/${knowledge.id}?turn=${knowledge.turnId}&cite=${index}`;
  await queueAssistantTurn(request, [
    { type: 'text', text: `退款在 \`refund()\` 中先扣手续费 [[1]](${cite(1)})，再四舍五入到分 [[2]](${cite(2)})。` },
  ]);
  await say('退款金额在哪里四舍五入？');
  await settledConversation(request, conversation.id);

  await queueAssistantTurn(request, [{ type: 'error', name: 'ProviderAuthError', message: '访问令牌已失效。' }]);
  await say('写一份本周的周报');
  await settledConversation(request, conversation.id);

  await queueAssistantTurn(request, [
    appTool('projects_update', { id: project.id, checkCommand: 'npm test' }),
    { type: 'text', text: '请在卡片上确认。' },
  ]);
  await say('把检查命令改成 npm test');
  await expect
    .poll(
      async () =>
        (await api<{ items: unknown[] }>(request, 'GET', `/assistant/conversations/${conversation.id}/confirmations`))
          .items.length,
    )
    .toBe(1);
  await settledConversation(request, conversation.id);
  return { busy: busy.id, conversation: conversation.id };
}

/** One task per state the task page renders differently (14 §3.3), each in its own project so scripts stay apart. */
async function seed(request: APIRequestContext): Promise<Seed> {
  // Several scenes keep an AI session working on purpose, and specs before this one may have left theirs: room for
  // the steps the seed needs finished, put back once it is done (03 §8, the scheduler's global limit).
  const settings = await api<Record<string, unknown>>(request, 'GET', '/settings');
  await patchSettings(request, { 'scheduler.maxConcurrentAttempts': 16 });
  const fixScripts = async (project: E2EProject, file: string) => {
    // Markdown as models write it (14 §2.2): a heading, emphasis, inline code and a code block with a long line.
    await queueTurn(request, project, { title: '定位根因' }, [
      submitResult(
        `## 复现与根因定位\n\n**根因**：\`${file}:1\` 用服务器本地时区换算，部署在 UTC+8 时早 8 小时。\n\n\`\`\`text\n✖ toLocal(1700000000000) expected '2023-11-14T22:13:20.000Z' but received '2023-11-15T06:13:20.000+08:00' (server time zone)\n\`\`\``,
      ),
    ]);
    await queueTurn(request, project, { title: '修复' }, [
      { type: 'think', text: 'The timestamps are formatted with the server time zone.\nConvert in UTC instead.' },
      { type: 'text', text: '时区换算用了服务器本地时区，改为统一按 UTC 换算。' },
      { type: 'tool', tool: 'read', input: { filePath: file } },
      { type: 'tool', tool: 'grep', input: { pattern: 'toLocal' } },
      { type: 'edit', file, content: 'export const toLocal = (t: number) => new Date(t).toISOString();\n' },
      {
        type: 'edit',
        file: file.replace(/\.ts$/, '.test.ts'),
        content:
          "import { toLocal } from './time';\n\ntest('formats in UTC whatever the server time zone is', () => expect(toLocal(1700000000000)).toBe('2023-11-14T22:13:20.000Z'));\n",
      },
      { type: 'tool', tool: 'bash', input: { command: 'pnpm test' } },
      {
        type: 'callTool',
        name: 'submit_result',
        args: {
          summary: '统一按 UTC 换算，并补充了 `toLocal` 的说明。',
          // The drawer's「改动」lists these, each path above what changed (14 §3.4).
          changes: [
            { path: file, description: '改用 `toISOString()`，不再依赖服务器本地时区' },
            { path: file.replace(/\.ts$/, '.test.ts'), description: '新增测试：在任何时区下都输出 UTC 时间' },
          ],
        },
      },
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
  await queueTurn(request, runningProject, { title: '定位根因' }, [
    { type: 'text', text: '先看导出逻辑，确认最后一行是在哪里丢的。' },
    { type: 'think', text: 'The export drops the last row.\nThe loop bound in buildRows() looks off by one.' },
    ...Array.from(
      { length: 12 },
      (_, i): FakeStep => ({
        type: 'tool',
        tool: 'read',
        input: { filePath: `src/export/part-${i}.ts` },
      }),
    ),
    { type: 'callTool', name: 'report_progress', args: { message: '正在复现缺少最后一行的问题' } },
    // Still thinking when the walkthrough looks: the stream shows its last lines live (25 §4.2).
    {
      type: 'think',
      text: 'The test should fail for the right reason: 3 rows expected, 2 exported.\nThen fix the bound to i < rows.length.',
    },
    { type: 'hang' },
  ]);
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

  // An answered knowledge question about the review project, with citations to open (K-09).
  mkdirSync(join(reviewProject.repoPath, 'src'), { recursive: true });
  writeFileSync(
    join(reviewProject.repoPath, 'src/refund.ts'),
    'export function refund(amount: number, fee: number) {\n  const net = amount - fee;\n  return Math.round(net * 100) / 100;\n}\n',
  );
  await queueResearchTurn(request, reviewProject, [
    { type: 'tool', tool: 'grep', input: { pattern: 'Math.round' } },
    { type: 'tool', tool: 'read', input: { filePath: join(reviewProject.repoPath, 'src/refund.ts') } },
    {
      type: 'callTool',
      name: 'submit_answer',
      args: {
        answer: '退款在 `refund()` 中先扣手续费 [1]，再四舍五入到分 [2]。',
        citations: [
          { type: 'file', path: 'src/refund.ts', start_line: 2, end_line: 2 },
          { type: 'file', path: 'src/refund.ts', start_line: 3, end_line: 3 },
        ],
      },
    },
  ]);
  const knowledge = await api<{ id: string }>(request, 'POST', '/knowledge/conversations', {
    projectId: reviewProject.id,
    question: '退款金额在哪里四舍五入？',
    sources: { code: true, docs: true, database: false, web: false },
  });
  type KnowledgeTurn = { id: string; status: string };
  const turnOf = async () =>
    (await api<{ turns: KnowledgeTurn[] }>(request, 'GET', `/knowledge/conversations/${knowledge.id}`)).turns[0];
  await expect.poll(async () => (await turnOf())?.status).toBe('answered');
  const knowledgeTurn = await turnOf();
  if (knowledgeTurn === undefined) throw new Error('knowledge turn not found');

  await queueResearchTurn(request, reviewProject, [
    { type: 'text', text: '退款在 `refund()` 中先扣手续费 [1]，再四舍五入到分 [2]。' },
    { type: 'permission', permission: 'bash', patterns: ['ls src'] },
  ]);
  const draft = await api<{ id: string }>(request, 'POST', '/knowledge/conversations', {
    projectId: reviewProject.id,
    question: '手续费在哪里扣？',
    sources: { code: true, docs: true, database: false, web: false },
  });
  await expect
    .poll(
      async () =>
        (await api<{ turns: { awaitingInput: boolean }[] }>(request, 'GET', `/knowledge/conversations/${draft.id}`))
          .turns[0]?.awaitingInput,
    )
    .toBe(true);

  // A reviewed commit and a branch of the user's own to merge, in the Git workbench (27).
  git(reviewProject.repoPath, 'branch', 'feature/walkthrough');
  const gitCommit = git(reviewProject.repoPath, 'rev-parse', 'main');
  await queueCodeReviewerTurn(request, reviewProject, [
    {
      type: 'callTool',
      name: 'submit_findings',
      args: {
        summary: '脚本可以运行；测试命令缺少覆盖率，建议补上。',
        findings: [
          {
            severity: 'major',
            category: 'tests',
            path: 'package.json',
            line: 1,
            title: '测试脚本没有收集覆盖率',
            description: '`vitest run` 不会报告哪些代码没有被测到。',
            suggestion: '改为 `vitest run --coverage`。',
          },
        ],
      },
    },
  ]);
  const gitReview = await api<{ id: string }>(request, 'POST', `/projects/${reviewProject.id}/git/reviews`, {
    target: { kind: 'commit', sha: gitCommit },
  });
  await expect
    .poll(async () => (await api<{ status: string }>(request, 'GET', `/git/reviews/${gitReview.id}`)).status)
    .toBe('succeeded');

  const batchProject = await createProject(request, null);
  await queueTurn(request, batchProject, { title: '代码审查' }, [submitResult('审查完成：发现 2 个问题。')]);
  await queueTurn(request, batchProject, { title: '代码审查' }, [{ type: 'hang' }]);
  const workflowList = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  const batch = await api<{ id: string }>(request, 'POST', '/batches', {
    projectId: batchProject.id,
    workflowId: workflowList.items.find((w) => w.key === 'code_review')?.id,
    requirementTemplate: '审查 {{target}} 的代码，列出问题、位置与改进建议。',
    targets: ['src/order/', 'src/payment/'],
  });
  type BatchCounts = { counts: { group: string; count: number }[] };
  await expect
    .poll(async () => (await api<BatchCounts>(request, 'GET', `/batches/${batch.id}`)).counts.map((c) => c.group))
    .toEqual(['running', 'review']);
  // The schedule's run takes the next code-review turn; the batch's tasks already took theirs.
  await queueTurn(request, batchProject, { title: '代码审查' }, [submitResult('审查完成：没有发现问题。')]);
  const schedule = await api<{ id: string }>(request, 'POST', '/schedules', {
    projectId: batchProject.id,
    workflowKey: 'code_review',
    requirement: '每周审查订单模块的改动',
    frequency: { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00' },
  });
  await api(request, 'POST', `/schedules/${schedule.id}/run`);
  const assistant = await seedAssistant(request, reviewProject, { id: knowledge.id, turnId: knowledgeTurn.id });

  const pptProject = await createProject(request, null);
  type Deck = { id: string; status: string };
  const outline = (pages: Array<Record<string, unknown>>) => ({
    type: 'callTool' as const,
    name: 'submit_outline',
    args: {
      title: '订单服务退款改造',
      understanding: { audience: '团队同事与产品经理', duration: '约 15 分钟', assumptions: ['听众了解订单服务'] },
      slides: pages.map((p) => ({
        layout: p.layout,
        title: typeof p.title === 'string' ? p.title : '结论',
        points: ['说明这一页要讲的事'],
      })),
    },
  });
  const deckReaches = (id: string, status: string) =>
    expect.poll(async () => (await api<Deck>(request, 'GET', `/decks/${id}`)).status).toBe(status);
  await queueWriterTurn(request, pptProject, [outline(DECK_PAGES)]);
  const deckOutline = await api<Deck>(request, 'POST', '/decks', {
    brief: '向团队汇报退款改造',
    projectId: pptProject.id,
  });
  await deckReaches(deckOutline.id, 'outline_ready');
  await queueWriterTurn(request, pptProject, [outline(DECK_PAGES)]);
  // Dark pages: in the light app themes the workspace shows a PPT in another theme than its own.
  const deckMade = await api<Deck>(request, 'POST', '/decks', {
    brief: '退款改造评审',
    projectId: pptProject.id,
    theme: 'deepseek',
  });
  await deckReaches(deckMade.id, 'outline_ready');
  await queueWriterTurn(
    request,
    pptProject,
    DECK_PAGES.map((content, i) => ({
      type: 'callTool' as const,
      name: 'submit_slide',
      args: { page: i + 1, content, notes: '这一页的讲稿' },
    })),
  );
  await api(request, 'POST', `/decks/${deckMade.id}/generate`, {});
  await deckReaches(deckMade.id, 'ready');

  // Last: its first browser action starts the browser host, which would slow the batch above.
  const previewProject = await createProject(request, null);
  writeFileSync(
    join(previewProject.repoPath, 'server.mjs'),
    `import { createServer } from 'node:http';
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>订单</title><h1>订单列表</h1><p>共 3 笔订单</p>');
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`,
  );
  git(previewProject.repoPath, 'add', '-A');
  git(previewProject.repoPath, 'commit', '-q', '-m', 'dev server');
  await api(request, 'PATCH', `/projects/${previewProject.id}`, {
    preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/orders'], extraOrigins: [] },
  });
  await queueTurn(request, previewProject, { title: '定位根因' }, [
    { type: 'callTool', name: 'browser_open', args: { url: '/orders' } },
    { type: 'callTool', name: 'browser_viewport', args: { preset: 'mobile' } },
    submitResult('列表在窄屏上被截断'),
  ]);
  // The step waits for the user's acceptance: the task is running, with no AI session holding a slot or the preview.
  const preview = await startWorkflow(request, previewProject, 'bugfix', '订单列表在手机上显示不全', false, true);
  await expect
    .poll(
      async () => (await api<Task>(request, 'GET', `/tasks/${preview}`)).nodes.find((n) => n.key === 'locate')?.status,
      {
        timeout: 20_000,
      },
    )
    .toBe('awaiting_acceptance');

  const completedReview = await waitForStatus(request, completed, 'review');
  await patchSettings(request, { 'scheduler.maxConcurrentAttempts': settings['scheduler.maxConcurrentAttempts'] });
  await api(request, 'POST', `/tasks/${completedReview.id}/deliver`, { strategy: 'squash' });
  // The task in review has an acceptance checklist (31): the result card lists it, delivery reminds of unmet items.
  const inReview = await waitForStatus(request, review, 'review');
  await api(request, 'PUT', `/tasks/${inReview.id}/requirements`, {
    items: [
      {
        title: '订单时间按用户所在时区显示',
        expected: '东八区用户看到的下单时间与实际一致，跨日的订单显示在正确的日期下',
      },
      {
        title: '单元测试通过',
        expected: '退出码 0',
        verification: { kind: 'command', command: 'pnpm test --filter order-time' },
      },
      {
        title: '旧订单不受影响',
        expected: '迁移前的订单时间显示不变',
        required: false,
        verification: { kind: 'manual' },
      },
    ],
  });
  return {
    project: reviewProject,
    running: await waitForStatus(request, running, 'running'),
    preview: await waitForStatus(request, preview, 'running'),
    question: await waitForStatus(request, question, 'running'),
    planReview: await waitForStatus(request, planReview, 'plan_review'),
    failed: await waitForStatus(request, failed, 'failed'),
    review: inReview,
    completed: await waitForStatus(request, completed, 'completed'),
    fixedKey,
    aiKey,
    knowledge: { id: knowledge.id, turnId: knowledgeTurn.id },
    knowledgeDraft: draft.id,
    batch: batch.id,
    schedule: schedule.id,
    assistantBusy: assistant.busy,
    assistantConversation: assistant.conversation,
    deckOutline: deckOutline.id,
    deckMade: deckMade.id,
    gitCommit,
  };
}

type Shot = {
  name: string;
  mode: UiMode;
  url: (s: Seed) => string;
  /** Visible once the page has its content. */
  ready: (page: Page) => Locator;
  /** Opens a dialog, drawer or editor before the screenshot. */
  open?: (page: Page, s: Seed) => Promise<Locator>;
  /** The document itself scrolls (a page outside the shell): the screenshot takes all of it. */
  fullPage?: boolean;
  /**
   * Seen as on a first run: the seed has projects, and with any project `/onboarding` leads to `/environment`
   * (14 §3.1a), so the page's project list answers empty.
   */
  firstRun?: boolean;
};

const PROJECT_LIST = (url: URL) => url.pathname === `${API_PREFIX}/projects`;

const node = (task: Task, key: string) => {
  const found = task.nodes.find((n) => n.key === key);
  if (found === undefined) throw new Error(`node ${key} not found`);
  return found.id;
};
/**
 * Opens the assistant panel, on conversation `id` when given. By id, not title: after a failed theme Playwright runs
 * `beforeAll` again in a new worker against the same backend, so every seeded title then exists twice.
 */
async function openAssistant(page: Page, id?: string): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel).toBeVisible();
  if (id !== undefined) {
    await panel.getByRole('button', { name: '切换对话' }).click();
    await page.getByTestId(`conversation-${id}`).click();
  }
  return panel;
}
const heading = (name: string | RegExp) => (page: Page) => page.getByRole('heading', { name, level: 1 }).first();
const testId = (id: string) => (page: Page) => page.getByTestId(id).first();

const SHOTS: Shot[] = [
  {
    name: 'onboarding',
    mode: UiMode.Simple,
    url: () => '/onboarding',
    // The first-run page itself, not the environment page it leads to once a project exists.
    ready: (page) => page.getByLabel('仓库目录'),
    firstRun: true,
  },
  { name: 'environment', mode: UiMode.Simple, url: () => '/environment', ready: testId('check-Git') },
  {
    name: 'home',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}`,
    ready: heading('Everything is a Workflow.'),
  },
  {
    // 「开始任务」mode of the one input (D111).
    name: 'home-task',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}&workflow=bugfix&requirement=${encodeURIComponent('订单时间显示错了')}`,
    ready: (page) => page.getByText('开始任务 · 修 Bug'),
  },
  {
    // The attachment bar holding as many files as one input takes, one with a long name (30 §2).
    name: 'home-attachments',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}&workflow=bugfix&requirement=${encodeURIComponent('订单时间显示错了')}`,
    ready: (page) => page.getByText('开始任务 · 修 Bug'),
    open: async (page) => {
      const names = Array.from({ length: 10 }, (_, i) =>
        i === 0 ? '订单时间显示错误的复现步骤与预发环境日志摘录_2026-10-23_最终版.md' : `notes-${i + 1}.md`,
      );
      await page
        .locator('input[type="file"]')
        .setInputFiles(names.map((name) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(`${name}\n`) })));
      const list = page.getByRole('list', { name: '附加的资料' });
      await expect(list.getByRole('button', { name: /^查看 / })).toHaveCount(names.length);
      return list;
    },
  },
  {
    // 「验收要求」open when starting a task (31 §2.1): an AI item with a long expectation and a command item.
    name: 'home-requirements',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}&workflow=bugfix&requirement=${encodeURIComponent('订单时间显示错了')}`,
    ready: (page) => page.getByText('开始任务 · 修 Bug'),
    open: async (page) => {
      await page.getByRole('button', { name: '验收要求' }).click();
      await page.getByLabel('要求 1').fill('订单时间按用户所在时区显示，跨日的订单显示在正确的日期下');
      await page.getByLabel('预期结果 1').fill('东八区用户看到的下单时间与实际一致；凌晨下的单不会显示成前一天');
      await page.getByRole('button', { name: '添加一项' }).click();
      await page.getByLabel('要求 2').fill('单元测试通过');
      await page.getByLabel('预期结果 2').fill('退出码 0');
      await page.getByLabel('核验方式 2').selectOption('command');
      await page.getByLabel('命令 2').fill('pnpm test --filter order-time');
      return page.getByRole('group', { name: '验收要求' });
    },
  },
  {
    // A conversation on the home page, the work rail beside it (28 §2.1).
    name: 'home-conversation',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}&conversation=${s.assistantConversation}`,
    ready: testId('confirmation-card'),
  },
  {
    name: 'palette',
    mode: UiMode.Simple,
    url: (s) => `/?projectId=${s.project.id}`,
    ready: heading('Everything is a Workflow.'),
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
    // Scrolled up while the stream follows: 「回到最新」(25 §4.1).
    name: 'task-running-drawer-latest',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.running.id}?node=${node(s.running, 'locate')}&open=true`,
    ready: testId('stream-scroll'),
    open: async (page) => {
      await page.getByTestId('stream-scroll').evaluate((el) => el.scrollTo({ top: 0 }));
      return page.getByRole('button', { name: /回到最新/ });
    },
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
    // A step's summary in the side panel, rendered from Markdown (14 §2.2).
    name: 'task-review-step',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}?node=${node(s.review, 'locate')}`,
    ready: testId('result-card'),
    open: async (page) => {
      await page.getByText('查看步骤', { exact: true }).click();
      return page.getByTestId('task-side').getByRole('heading', { name: '复现与根因定位' });
    },
  },
  {
    // The step drawer's changes: the tree above the diff, which keeps the drawer's width (14 §2.3).
    name: 'node-drawer-changes',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}?node=${node(s.review, 'fix')}&open=true`,
    ready: testId('result-card'),
    open: async (page) => {
      await page.getByRole('tab', { name: '改动' }).click();
      await expect(page.getByTestId('diff-view')).toBeVisible();
      return page.getByRole('dialog');
    },
  },
  {
    // The large view (D114).
    name: 'node-changes-large',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}?node=${node(s.review, 'fix')}&open=true`,
    ready: testId('result-card'),
    open: async (page) => {
      await page.getByRole('tab', { name: '改动' }).click();
      await page.getByRole('button', { name: '放大查看' }).click();
      const large = page.getByRole('dialog', { name: '改动 · 修复' });
      await expect(large.getByTestId('diff-view')).toBeVisible();
      return large;
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
  {
    // An ended step's process folds to one line (25 §4.5).
    name: 'node-page-process',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}/nodes/${node(s.review, 'fix')}`,
    ready: testId('node-page'),
    open: async (page) => {
      await page.getByRole('tab', { name: '过程' }).click();
      await expect(page.getByRole('button', { name: /执行过程/ })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('button', { name: /评审过程/ })).toHaveAttribute('aria-expanded', 'false');
      return page.getByTestId('conversation-stream').filter({ hasText: '评审过程' });
    },
  },
  {
    // Opened: the calls in a row fold into a group, the thinking is folded (25 §4.2, §4.3).
    name: 'node-page-process-open',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.review.id}/nodes/${node(s.review, 'fix')}`,
    ready: testId('node-page'),
    open: async (page) => {
      await page.getByRole('tab', { name: '过程' }).click();
      await page.getByRole('button', { name: /执行过程/ }).click();
      return page.getByTestId('stream-group');
    },
  },
  { name: 'inbox', mode: UiMode.Simple, url: () => '/inbox', ready: testId('inbox-question') },
  {
    name: 'assistant-panel',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.running.id}`,
    ready: testId('progress-canvas'),
    open: async (page, s) => {
      const panel = await openAssistant(page, s.assistantConversation);
      await expect(panel.getByTestId('confirmation-card')).toContainText('检查命令');
      await expect(panel.getByTestId('entity-card')).toBeVisible();
      return panel;
    },
  },
  {
    name: 'assistant-busy',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.running.id}`,
    ready: testId('progress-canvas'),
    open: async (page, s) => {
      const panel = await openAssistant(page, s.assistantBusy);
      await expect(panel.getByTestId('assistant-thinking')).toBeVisible();
      return panel;
    },
  },
  {
    name: 'assistant-welcome',
    mode: UiMode.Simple,
    // On the home page ⌘J goes to the page's own input (D112); the panel is opened elsewhere.
    url: () => '/tasks',
    ready: (page) => page.getByRole('table'),
    open: async (page) => {
      const panel = await openAssistant(page);
      await panel.getByRole('button', { name: '新对话' }).click();
      await expect(panel.getByRole('heading', { name: '有什么可以帮你？' })).toBeVisible();
      return panel;
    },
  },
  {
    name: 'knowledge',
    mode: UiMode.Simple,
    url: (s) => `/knowledge?projectId=${s.project.id}`,
    ready: (page) => page.getByRole('heading', { name: '关于这个项目，你想了解什么？' }),
  },
  {
    name: 'knowledge-answer-source',
    mode: UiMode.Simple,
    url: (s) => `/knowledge/${s.knowledge.id}?turn=${s.knowledge.turnId}&cite=2`,
    ready: testId('citation-lines'),
  },
  {
    name: 'knowledge-draft',
    mode: UiMode.Simple,
    url: (s) => `/knowledge/${s.knowledgeDraft}`,
    ready: testId('answer-draft'),
  },
  {
    name: 'knowledge-history',
    mode: UiMode.Simple,
    url: () => '/knowledge/history',
    ready: testId('knowledge-history-row'),
  },
  { name: 'insights', mode: UiMode.Simple, url: () => '/insights', ready: testId('insights-simple') },
  { name: 'ppt', mode: UiMode.Simple, url: () => '/ppt', ready: testId('deck-card') },
  {
    name: 'ppt-new',
    mode: UiMode.Simple,
    url: (s) => `/ppt/new?projectId=${s.project.id}`,
    ready: heading('做一份 PPT'),
  },
  { name: 'ppt-outline', mode: UiMode.Simple, url: (s) => `/ppt/${s.deckOutline}`, ready: testId('outline-page') },
  { name: 'ppt-preview', mode: UiMode.Simple, url: (s) => `/ppt/${s.deckMade}`, ready: testId('slide-thumb') },
  // Every layout at full size in the theme: the walkthrough checks the pages' own contrast too.
  {
    name: 'ppt-pages',
    mode: UiMode.Simple,
    url: (s) => `/ppt/${s.deckMade}/print`,
    ready: testId('slide-canvas'),
    fullPage: true,
  },
  {
    name: 'batch-new',
    mode: UiMode.Simple,
    url: (s) => `/batches/new?projectId=${s.project.id}&workflow=unit_tests`,
    ready: heading('新建批量任务'),
  },
  { name: 'batch', mode: UiMode.Simple, url: (s) => `/batches/${s.batch}`, ready: testId('batch-item') },
  {
    name: 'batch-deliver',
    mode: UiMode.Simple,
    url: (s) => `/batches/${s.batch}`,
    ready: testId('batch-item'),
    open: async (page) => {
      await page.getByRole('button', { name: '完成全部待完成的报告（1）' }).click();
      return page.getByRole('dialog', { name: '完成 1 份报告？' });
    },
  },
  { name: 'batches', mode: UiMode.Simple, url: () => '/batches', ready: testId('batch-card') },
  {
    name: 'schedule-new',
    mode: UiMode.Simple,
    url: (s) => `/schedules/new?projectId=${s.project.id}&workflow=unit_tests`,
    ready: heading('新建定时任务'),
  },
  { name: 'schedule', mode: UiMode.Simple, url: (s) => `/schedules/${s.schedule}`, ready: testId('schedule-run') },
  {
    name: 'schedule-delete',
    mode: UiMode.Simple,
    url: (s) => `/schedules/${s.schedule}`,
    ready: testId('schedule-run'),
    open: async (page) => {
      await page.getByRole('button', { name: '删除' }).click();
      return page.getByRole('dialog', { name: '删除这个定时任务？' });
    },
  },
  { name: 'schedules', mode: UiMode.Simple, url: () => '/schedules', ready: testId('schedule-card') },
  {
    name: 'schedule-edit-pro',
    mode: UiMode.Pro,
    url: (s) => `/schedules/${s.schedule}/edit`,
    ready: heading('修改定时任务'),
  },
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
    ready: heading('Everything is a Workflow.'),
    open: async (page) => {
      await page
        .getByRole('group', { name: '直接开始' })
        .getByRole('button', { name: '新功能开发', exact: true })
        .click();
      await page.getByText('更多选项').click();
      return page.getByLabel('标题');
    },
  },
  {
    // The preview tab; the browser build points to the desktop app for the live page (29 §8.7), a stopped preview to
    // its start.
    name: 'task-preview',
    mode: UiMode.Simple,
    url: (s) => `/tasks/${s.preview.id}?view=preview`,
    // The preview may have stopped for idleness on a slow runner; the pane shows either way.
    ready: testId('preview-pane'),
  },
  {
    // What the AI saw after each action (29 §8.2), with the pro bottom bar.
    name: 'pro-task-preview-frames',
    mode: UiMode.Pro,
    url: (s) => `/tasks/${s.preview.id}?view=preview`,
    // The preview may have stopped for idleness on a slow runner; the pane shows either way.
    ready: testId('preview-pane'),
    open: async (page) => {
      await page.getByLabel('查看').selectOption({ index: 1 });
      await expect(page.getByRole('list', { name: '动作' })).toContainText('2. 切换尺寸');
      return page.getByRole('img', { name: /切换尺寸/ });
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
    ready: testId('conversation-stream'),
    open: async (page) => {
      await page.getByRole('button', { name: /执行 #1/ }).click();
      // Ended, so the calls in a row are folded into a group first.
      await page.getByTestId('stream-group').first().getByRole('button').first().click();
      await page.getByTestId('stream-action').first().getByRole('button').click();
      return page.getByText('内部工具名').first();
    },
  },
  { name: 'pro-project', mode: UiMode.Pro, url: (s) => `/projects/${s.project.id}`, ready: heading(/.+/) },
  { name: 'pro-settings', mode: UiMode.Pro, url: () => '/settings', ready: (page) => page.getByText('专业设置') },
  {
    name: 'pro-git',
    mode: UiMode.Pro,
    url: () => '/git',
    ready: (page) => page.getByTestId('git-project-card').first(),
  },
  {
    name: 'pro-git-changes',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=changes`,
    ready: testId('git-changes'),
  },
  {
    name: 'pro-git-commit',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=commits&sha=${s.gitCommit}`,
    ready: (page) => page.getByTestId('git-commit').getByTestId('diff-view'),
  },
  {
    name: 'pro-git-review',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=commits&sha=${s.gitCommit}&tab=review`,
    ready: testId('git-review-verdict'),
  },
  {
    name: 'pro-git-branches',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=branches`,
    ready: (page) => page.getByTestId('git-branch').first(),
  },
  {
    name: 'pro-git-merge',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=branches`,
    ready: (page) => page.getByTestId('git-branch').first(),
    open: async (page) => {
      await page
        .getByTestId('git-branch')
        .filter({ hasText: 'feature/walkthrough' })
        .getByRole('button', { name: '合并到 main' })
        .click();
      return page.getByRole('dialog', { name: '合并到 main' });
    },
  },
  {
    name: 'pro-git-push',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=commits`,
    ready: testId('git-status'),
    open: async (page) => {
      await page.getByTestId('git-status').getByRole('button', { name: /^推送/ }).click();
      return page.getByRole('dialog', { name: '推送 main 到 origin？' });
    },
  },
  ...(['files', 'worktrees'] as const).map(
    (view): Shot => ({
      name: `pro-git-${view}`,
      mode: UiMode.Pro,
      url: (s) => `/git/${s.project.id}?view=${view}`,
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
  {
    name: 'pro-insights',
    mode: UiMode.Pro,
    url: () => '/insights?period=last_30_days',
    ready: testId('insights-tasks'),
  },
  { name: 'pro-roles', mode: UiMode.Pro, url: () => '/roles', ready: (page) => page.getByRole('article').first() },
  { name: 'pro-databases', mode: UiMode.Pro, url: () => '/databases', ready: heading('数据库') },
  { name: 'pro-tools', mode: UiMode.Pro, url: () => '/tools', ready: heading('MCP 工具') },
  { name: 'pro-runtime', mode: UiMode.Pro, url: () => '/runtime', ready: testId('runtime-details') },
  {
    name: 'pro-knowledge',
    mode: UiMode.Pro,
    url: (s) => `/knowledge/${s.knowledge.id}`,
    ready: testId('knowledge-turn'),
    open: async (page) => {
      await page
        .getByTestId('research-process')
        .getByRole('button', { name: /研究过程/ })
        .click();
      return page.getByTestId('stream-scroll');
    },
  },
  {
    name: 'pro-assistant-panel',
    mode: UiMode.Pro,
    url: (s) => `/git/${s.project.id}?view=commits`,
    ready: testId('git-status'),
    open: async (page, s) => {
      const panel = await openAssistant(page, s.assistantConversation);
      await panel.getByTestId('assistant-action').first().locator('summary').click();
      await expect(panel.getByText('agent-workflow-app_projects_list')).toBeVisible();
      return panel;
    },
  },
];

test.use({ viewport: { width: WIDTH, height: HEIGHT } });

// One test per theme, so CI can run the themes on separate machines (`--grep @walkthrough --shard`, 17 §4.1). The
// `parallel` mode only lets shards split them: with the single worker they run one after another and share the seed.
test.describe('J9 走查：两种模式下全部页面无报错、无对比度与横向溢出问题', { tag: '@walkthrough' }, () => {
  // A theme takes about 20 s on a Mac and over a minute on a Windows CI runner (17 §4.1).
  test.describe.configure({ mode: 'parallel', timeout: 600_000 });
  let request: APIRequestContext;
  let s: Seed;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000);
    request = await playwright.request.newContext();
    s = await seed(request);
  });
  test.afterAll(async () => {
    // A failed seed is already reported by beforeAll; there is nothing running to stop then.
    if (s !== undefined) {
      await api(request, 'POST', `/tasks/${s.running.id}/cancel`);
      await api(request, 'POST', `/tasks/${s.preview.id}/cancel`);
      await api(request, 'POST', `/assistant/conversations/${s.assistantBusy}/abort`);
    }
    await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
    await request.dispose();
  });

  for (const theme of THEME_IDS) {
    test(theme, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      const dir = join(WALKTHROUGH_DIR, theme);
      mkdirSync(dir, { recursive: true });
      const reports: Record<string, PageReport> = {};
      for (const shot of SHOTS) {
        await patchSettings(request, { 'ui.theme': theme satisfies ThemeId, 'ui.mode': shot.mode });
        await page.setViewportSize({ width: WIDTH, height: HEIGHT });
        if (shot.firstRun === true) await page.route(PROJECT_LIST, (route) => route.fulfill({ json: { items: [] } }));
        await page.goto(shot.url(s));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(shot.ready(page)).toBeVisible();
        await expect(page.getByText('正在加载…')).toHaveCount(0);
        if (shot.open !== undefined) await expect(await shot.open(page, s)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        // Pages render failures through ErrorState, the only role="alert" element.
        await expect.soft(page.getByRole('alert'), shot.name).toHaveCount(0);
        reports[shot.name] = await inspectPage(page);

        await fullHeight(page, WIDTH, HEIGHT);
        await page.screenshot({
          path: join(dir, `${shot.name}.png`),
          animations: 'disabled',
          fullPage: shot.fullPage === true,
        });
        if (shot.firstRun === true) await page.unroute(PROJECT_LIST);
      }
      writeFileSync(join(dir, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
      const problems = Object.entries(reports)
        .filter(([, r]) => r.contrast.length > 0 || r.overflow.length > 0)
        .map(([name, r]) => [name, [...r.contrast, ...r.overflow]]);
      expect.soft(Object.fromEntries(problems)).toEqual({});
      expect(pageErrors).toEqual([]);
    });
  }
});
