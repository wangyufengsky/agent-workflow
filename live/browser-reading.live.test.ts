import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  AssistantConfirmationStatus,
  AssistantPage,
  AttemptKind,
  askKnowledgeOp,
  bindAssistantPreviewOp,
  CitationType,
  confirmAssistantCallOp,
  createProjectOp,
  getKnowledgeOp,
  getPreviewOp,
  InboxKind,
  InboxStatus,
  KnowledgeTurnStatus,
  listConfirmationsOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  navigateUserTabOp,
  openUserTabOp,
  PreviewState,
  resolveInboxOp,
  ServerEventType,
  startPreviewOp,
  TaskStatus,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createChromiumHost } from '../packages/server/src/modules/browser/host.chromium.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { createTask, taskReaches } from '../packages/server/test/helpers/tasks.ts';
import { type AssistantEvaluation, during, startAssistantEvaluation } from './assistant-evaluation.ts';
import { previewServer } from './assistant-web-fixture.ts';
import { TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * B3's completion test (29 §13, 05 B3-04), the default free model: the knowledge researcher reads an intranet page
 * whose text only appears when its script runs, through the browser, and its web citation keeps what the page said
 * (29 §2.8); the assistant starts a task's preview, opens its preview tab, and reads the console error of the page the
 * user has open (29 §2.6, 15). Run by hand: `pnpm test:live live/browser-reading.live.test.ts`.
 */
const host = createChromiumHost();
const marker = `B3-${randomUUID()}`;
const site = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  // Without the script the page is empty: only a browser reads the rule.
  res.end(`<title>退款规范</title><main id="app"></main><script>
    app.innerHTML = '<h1>退款规范</h1><p>退款金额四舍五入到分，手续费先扣。规范编号 ${marker}。</p>';
  </script>`);
});
let siteUrl: string;
let evaluation: AssistantEvaluation;
let projectId: string;
let unsubscribe = () => {};

beforeAll(async () => {
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  siteUrl = `http://127.0.0.1:${address.port}/refunds`;
  evaluation = await startAssistantEvaluation('browser-reading', host);
  const { t } = evaluation;
  expect((await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access: 'read' }] })).status).toBe(
    200,
  );
  const repo = await createTestRepo({
    files: { 'README.md': '# 退款服务\n', 'greeting.txt': 'helo\n', 'server.mjs': previewServer(marker) },
  });
  projectId = (await t.call(createProjectOp, { repoPath: repo.path })).body.id;
  await t.call(updateProjectOp, {
    id: projectId,
    preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
  });
  // Permission requests of the researcher and the task's AI are allowed once, as a user would.
  unsubscribe = t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.InboxUpdated || event.data.item.status !== InboxStatus.Open) return;
    if (event.data.item.kind !== InboxKind.Permission) return;
    void t.call(resolveInboxOp, { id: event.data.item.id, response: { decision: 'once' } });
  });
}, 120_000);
afterAll(async () => {
  unsubscribe();
  try {
    await evaluation.close();
  } finally {
    await host.close();
    site.close();
  }
});

it(
  '@live 知识问答用浏览器读要执行脚本的内网网页，网页引用带读到的正文摘录',
  async () => {
    const { t } = evaluation;
    const ended = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.kind === AttemptKind.Research && d.attempt.endedAt !== null,
      TASK_TIMEOUT_MS,
    );
    const { body: asked } = await t.call(askKnowledgeOp, {
      projectId,
      question: `内网规范 ${siteUrl} 怎么规定退款金额取整和手续费？这个页面要执行脚本才显示正文，请用浏览器打开它并引用这个网页。`,
      sources: { code: true, docs: false, database: false, web: true },
    });
    await ended;
    const turn = (await t.call(getKnowledgeOp, { id: asked.id })).body.turns[0];
    evaluation.facts.knowledgeTurn = turn;
    expect(turn?.attempt.error).toBeNull();
    expect(turn?.status).toBe(KnowledgeTurnStatus.Answered);
    const web = (turn?.citations ?? []).flatMap((c) => (c.type === CitationType.Web ? [c] : []));
    expect(web.some((c) => c.url.startsWith(siteUrl) && c.excerpt?.includes(marker))).toBe(true);
  },
  TASK_TIMEOUT_MS,
);

it(
  '@live 助手启动任务预览、打开预览页签，再读用户正在看的页面的控制台错误',
  async () => {
    const { t } = evaluation;
    const planned = taskReaches(t, TaskStatus.PlanReview, TASK_TIMEOUT_MS);
    const task = await createTask(t, {
      projectId,
      workflow: 'bugfix',
      requirement: 'greeting.txt 里的 helo 拼错了，改成 hello',
      checkpoints: { confirm_plan: true },
    });
    evaluation.tasks.add(task.id);
    await planned;
    const id = await evaluation.conversation('启动预览并读页面错误');
    const page = { page: AssistantPage.Task, params: { taskId: task.id } };

    // The UI's part: when the assistant opens the preview tab, the tab opens the user's preview and binds it.
    let opened: Promise<void> | undefined;
    const offNavigate = t.app.events.subscribe((event) => {
      if (event.type !== ServerEventType.AssistantNavigate || event.data.conversationId !== id) return;
      if (event.data.target.page !== AssistantPage.TaskPreview || opened !== undefined) return;
      opened = (async () => {
        const { body: tab } = await t.call(openUserTabOp, { taskId: task.id });
        await t.call(bindAssistantPreviewOp, { id, preview: { taskId: task.id, tabId: tab.tabId } });
      })();
    });
    try {
      const ask = await evaluation.turn(id, 'start-preview', '启动这个任务的页面预览，然后打开预览页签给我看。', {
        context: page,
      });
      expect(ask.tools.map((tool) => tool.tool)).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}previews_start`);
      const start = (await t.call(listConfirmationsOp, { id })).body.items.find(
        (item) => item.operationId === startPreviewOp.id && item.status === AssistantConfirmationStatus.Pending,
      );
      if (start === undefined) throw new Error('Expected the preview start confirmation');
      const afterSeq = (await evaluation.entries(id)).at(-1)?.seq ?? 0;
      await during(
        t,
        (event) => event.type === ServerEventType.AssistantUpdated && event.data.id === id && !event.data.busy,
        async () => {
          expect((await t.call(confirmAssistantCallOp, { id: start.id })).body.result?.ok).toBe(true);
        },
      );
      const continued = await evaluation.completedCheckpoint('preview-started', id, afterSeq);
      expect((await t.call(getPreviewOp, { taskId: task.id })).body.state).toBe(PreviewState.Running);
      const toolsSoFar = [...ask.tools, ...continued.tools].map((tool) => tool.tool);
      expect(toolsSoFar).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}open_page`);
      if (opened === undefined) throw new Error('Expected the assistant to open the preview tab');
      await opened;
      // The user goes to the page that shows the error, then asks.
      const { body: tab } = await t.call(openUserTabOp, { taskId: task.id });
      expect((await t.call(navigateUserTabOp, { tabId: tab.tabId, path: '/broken' })).status).toBe(204);

      const read = await evaluation.turn(id, 'read-preview-errors', '这个页面为什么报错？告诉我控制台里的错误。', {
        context: { page: AssistantPage.TaskPreview, params: { taskId: task.id } },
      });
      expect(read.tools.map((tool) => tool.tool)).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}browser_read`);
      expect(read.reply).toContain(`PREVIEW-CONSOLE-${marker}`);
    } finally {
      offNavigate();
    }
  },
  TASK_TIMEOUT_MS * 2,
);
