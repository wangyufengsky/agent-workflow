import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
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
import { localTime } from '../packages/server/src/modules/assistant/assistant.context.ts';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** A-09: one real conversation with the assistant (07 §6), the free test model. */
const TURN_TIMEOUT_MS = 5 * 60_000;
const PROJECT_NAME = '库存服务';
const DAY_MS = 86_400_000;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-assistant-')));
  await runGit(['init', '-q', '-b', 'main'], { cwd: repo });
  await runGit(
    ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'],
    {
      cwd: repo,
    },
  );
  await t.call(createProjectOp, { repoPath: repo, name: PROJECT_NAME });
  // opencode may take up to OPENCODE_START_TIMEOUT_MS to come up.
}, 60_000);
afterAll(() => t.close());

describe('@live 应用助手', () => {
  it('查明天的日期并列出项目：调用 get_current_time 与 projects_list，回复包含两者', async () => {
    const { body: conversation } = await t.call(createConversationOp, {});
    const idle = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === conversation.id && !c.busy,
      TURN_TIMEOUT_MS,
    );
    await t.call(sendAssistantMessageOp, {
      id: conversation.id,
      text: '明天是几月几号？另外列出我的项目。',
      context: { page: 'home', params: {} },
    });
    await idle;

    const file = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR, `${conversation.id}.jsonl`);
    const entries: TranscriptEntry[] = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const tools = entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : []));
    // The last line of each streamed part holds its whole text.
    const parts = new Map(entries.flatMap((e) => (e.kind === 'text' ? [[e.partId, e.data.text] as const] : [])));
    const reply = [...parts.values()].join('\n');
    const errors = entries.filter((e) => e.kind === 'error');
    await mkdir(new URL('reports', import.meta.url), { recursive: true });
    const report = new URL(`reports/assistant-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
    await writeFile(report, JSON.stringify({ model: TEST_MODEL, tools, reply, errors }, null, 2));

    expect(errors).toEqual([]);
    expect(tools).toEqual(
      expect.arrayContaining([
        `${MCP_ASSISTANT_TOOL_PREFIX}get_current_time`,
        `${MCP_ASSISTANT_TOOL_PREFIX}projects_list`,
      ]),
    );
    const tomorrow = localTime(Date.now() + DAY_MS, Intl.DateTimeFormat().resolvedOptions().timeZone).date;
    const [, month, day] = tomorrow.split('-').map(Number);
    expect(reply).toMatch(new RegExp(`${tomorrow}|${month}\\s*月\\s*${day}\\s*日|${month}/${day}`));
    expect(reply).toContain(PROJECT_NAME);
  });
});
