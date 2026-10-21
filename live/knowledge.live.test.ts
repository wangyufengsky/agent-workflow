import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttemptKind,
  askKnowledgeOp,
  CitationType,
  createProjectOp,
  getKnowledgeOp,
  getRuntimeOp,
  InboxKind,
  InboxStatus,
  KnowledgeTurnStatus,
  knowledgeCitationOp,
  resolveInboxOp,
  ServerEventType,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** K-10: one real question to the knowledge researcher (07 §6), the free test model, the `ts-stats` fixture. */
const TURN_TIMEOUT_MS = 10 * 60_000;
const IDENTITY = ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com'];
/** `median` in `live/fixtures/ts-stats/src/stats.ts`: the answer must cite lines of it. */
const MEDIAN_LINES = { first: 8, last: 13 };

let t: TestApp;
let projectId: string;
/** Permission requests of the researcher, allowed once like a user would (its bash is read-only, D69). */
const asked: string[] = [];

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-knowledge-')));
  await cp(new URL('fixtures/ts-stats', import.meta.url).pathname, repo, { recursive: true });
  await runGit(['init', '-q', '-b', 'main'], { cwd: repo });
  await runGit([...IDENTITY, 'add', '-A'], { cwd: repo });
  await runGit([...IDENTITY, 'commit', '-q', '-m', 'init'], { cwd: repo });
  projectId = (await t.call(createProjectOp, { repoPath: repo })).body.id;
  t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.InboxUpdated || event.data.item.status !== InboxStatus.Open) return;
    const { item } = event.data;
    if (item.kind !== InboxKind.Permission) return;
    asked.push(`${item.payload.permission}: ${item.payload.patterns.join(' | ')}`);
    void t.call(resolveInboxOp, { id: item.id, response: { decision: 'once' } });
  });
}, 60_000);
afterAll(() => t.close());

describe('@live 知识问答', () => {
  it('回答带有效引用，且引用指向 median 的实现', async () => {
    const ended = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.kind === AttemptKind.Research && d.attempt.endedAt !== null,
      TURN_TIMEOUT_MS,
    );
    const { body: asked0 } = await t.call(askKnowledgeOp, {
      projectId,
      question: 'median 函数是怎样排序的？用的是哪种比较方式？',
      sources: { code: true, docs: true, database: false, web: false },
    });
    await ended;
    const { body: conversation } = await t.call(getKnowledgeOp, { id: asked0.id });
    const turn = conversation.turns[0];
    if (turn === undefined) throw new Error('no turn');

    const transcript = join(t.dataDir, 'runs', 'knowledge', `${turn.attempt.id}.jsonl`);
    const entries: TranscriptEntry[] = (await readFile(transcript, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const tools = entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : []));
    const submits = entries.filter((e) => e.kind === 'tool_result' && e.data.tool.endsWith('submit_answer'));
    await mkdir(new URL('reports', import.meta.url), { recursive: true });
    const report = new URL(`reports/knowledge-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
    await writeFile(
      report,
      JSON.stringify(
        {
          model: TEST_MODEL,
          status: turn.status,
          error: turn.attempt.error,
          nudges: turn.attempt.nudges,
          seconds: turn.attempt.endedAt === null ? null : (turn.attempt.endedAt - turn.attempt.startedAt) / 1000,
          submitAnswer: submits.map((e) => (e.kind === 'tool_result' ? e.data.status : '')),
          tools,
          asked,
          answer: turn.answer,
          citations: turn.citations,
        },
        null,
        2,
      ),
    );

    expect(turn.attempt.error).toBeNull();
    expect(turn.status).toBe(KnowledgeTurnStatus.Answered);
    const files = turn.citations.flatMap((c) => (c.type === CitationType.File ? [c] : []));
    expect(files.length).toBeGreaterThan(0);
    const median = files.filter(
      (c) => c.path === 'src/stats.ts' && c.startLine <= MEDIAN_LINES.last && c.endLine >= MEDIAN_LINES.first,
    );
    expect(median.length).toBeGreaterThan(0);
    // Every citation opens: the backend checked it on submit and reads it again here.
    for (let index = 1; index <= turn.citations.length; index++) {
      expect((await t.call(knowledgeCitationOp, { turnId: turn.id, index })).status).toBe(200);
    }
  });
});
