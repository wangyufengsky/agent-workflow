import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  type ChartSpec,
  createConversationOp,
  createProjectOp,
  getRuntimeOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** V-06: the assistant draws charts from real figures (35 §6) with the free test model. */
const TURN_TIMEOUT_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const PROJECT_NAME = '订单服务';
/** Commits per member in the last 30 days; the initial commit is older. */
const COMMITS = { 张三: 3, 李四: 2, 王五: 1 } as const;

let t: TestApp;
const reports: Record<string, unknown> = {};

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-charts-')));
  const git = (...args: string[]) =>
    runGit(['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com', ...args], { cwd: repo });
  const commit = async (author: string, daysAgo: number, message: string) => {
    await writeFile(join(repo, `${message}.txt`), `${message}\n`);
    await git('add', '-A');
    const date = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
    await git('commit', '-q', `--author=${author}`, `--date=${date}`, '-m', message);
  };
  await git('init', '-q', '-b', 'main');
  await commit('aw-live <aw-live@example.com>', 60, 'init');
  let day = 1;
  for (const [index, [name, count]] of Object.entries(COMMITS).entries()) {
    for (let i = 0; i < count; i++) await commit(`${name} <m${index}@corp.com>`, day++, `work-${index}-${i}`);
  }
  await t.call(createProjectOp, { repoPath: repo, name: PROJECT_NAME });
}, 60_000);
afterAll(async () => {
  await mkdir(new URL('reports', import.meta.url), { recursive: true });
  const file = new URL(
    `reports/assistant-charts-${new Date().toISOString().replaceAll(':', '-')}.json`,
    import.meta.url,
  );
  await writeFile(file, JSON.stringify({ model: TEST_MODEL, ...reports }, null, 2));
  await t.close();
});

/** One message in a new conversation; what the assistant called, drew and wrote. */
async function ask(text: string) {
  const { body: conversation } = await t.call(createConversationOp, {});
  const idle = waitForEvent(
    t.app.events,
    ServerEventType.AssistantUpdated,
    (c) => c.id === conversation.id && !c.busy,
    TURN_TIMEOUT_MS,
  );
  await t.call(sendAssistantMessageOp, { id: conversation.id, text, context: { page: 'home', params: {} } });
  await idle;
  const file = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR, `${conversation.id}.jsonl`);
  const entries: TranscriptEntry[] = (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const tools = entries.flatMap((e) =>
    e.kind === 'tool_call' ? [e.data.tool.replace(MCP_ASSISTANT_TOOL_PREFIX, '')] : [],
  );
  const failed = entries.flatMap((e) => (e.kind === 'tool_result' && e.data.status === 'error' ? [e.data] : []));
  const charts: ChartSpec[] = entries.flatMap((e) => (e.kind === 'chart' ? [e.data.chart] : []));
  const parts = new Map(entries.flatMap((e) => (e.kind === 'text' ? [[e.partId, e.data.text] as const] : [])));
  const errors = entries.filter((e) => e.kind === 'error');
  return { tools, failed, charts, reply: [...parts.values()].join('\n'), errors };
}

describe('@live 助手画图', () => {
  it('成员提交数画成柱状图：先取团队统计，图中数字与提交历史一致', async () => {
    const result = await ask(`统计项目「${PROJECT_NAME}」最近 30 天每个成员的提交数，画成柱状图。`);
    reports.teamBar = result;

    expect(result.errors).toEqual([]);
    expect(result.tools).toEqual(expect.arrayContaining(['team_summary', 'show_chart']));
    const bar = result.charts.find((c) => c.type === 'bar');
    if (bar === undefined || bar.type !== 'bar') throw new Error(`no bar chart: ${JSON.stringify(result.charts)}`);
    const [series] = bar.series;
    for (const [name, count] of Object.entries(COMMITS)) {
      const index = bar.categories.findIndex((c) => c.includes(name));
      expect(index, name).toBeGreaterThanOrEqual(0);
      expect(series?.values[index], name).toBe(count);
    }
  });

  it('内置流程画成流程图', async () => {
    const result = await ask('把内置的「修 Bug」流程的步骤画成流程图。');
    reports.workflowFlow = result;

    expect(result.errors).toEqual([]);
    expect(result.tools).toContain('show_flowchart');
    const flow = result.charts.find((c) => c.type === 'flow');
    if (flow === undefined || flow.type !== 'flow') throw new Error(`no flowchart: ${JSON.stringify(result.charts)}`);
    expect(flow.nodes.length).toBeGreaterThanOrEqual(3);
    expect(flow.edges.length).toBeGreaterThanOrEqual(2);
  });
});
