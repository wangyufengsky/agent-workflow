import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttemptKind,
  createDeckOp,
  createProjectOp,
  DeckStatus,
  generateDeckOp,
  getDeckOp,
  getRuntimeOp,
  InboxKind,
  InboxStatus,
  resolveInboxOp,
  ServerEventType,
  slideContentSchema,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** One real PPT (23 §13): the free test model writes a 5-page outline and the pages about the `ts-stats` fixture. */
const WORK_TIMEOUT_MS = 10 * 60_000;
const IDENTITY = ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com'];
const PAGES = 5;

let t: TestApp;
let projectId: string;
/** Permission requests of the writer, allowed once like a user would (its bash is read-only). */
const asked: string[] = [];

const workEnds = (kind: AttemptKind) =>
  waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (d) => d.attempt.kind === kind && d.attempt.endedAt !== null,
    WORK_TIMEOUT_MS,
  );

async function toolsOf(attemptId: string): Promise<string[]> {
  const file = join(t.dataDir, 'runs', 'ppt', `${attemptId}.jsonl`);
  const entries: TranscriptEntry[] = (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  return entries.flatMap((e) => (e.kind === 'tool_result' ? [`${e.data.tool} ${e.data.status}`] : []));
}

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-ppt-')));
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

describe('@live PPT', () => {
  it('大纲页数如要求，每页都通过版式校验，内容提到仓库里真实的函数', async () => {
    const outlined = workEnds(AttemptKind.DeckOutline);
    const { body: created } = await t.call(createDeckOp, {
      brief: '给新同事介绍这个统计库：有哪些函数、各自怎么算、怎么测试',
      projectId,
      slideCount: PAGES,
    });
    await outlined;
    const outline = (await t.call(getDeckOp, { id: created.id })).body;
    const outlineTools = await toolsOf(outline.runs[0]?.attempt.id ?? '');

    const made = workEnds(AttemptKind.DeckSlides);
    await t.call(generateDeckOp, { id: created.id });
    await made;
    const { body: deck } = await t.call(getDeckOp, { id: created.id });
    const run = deck.runs.at(-1);
    const slideTools = await toolsOf(run?.attempt.id ?? '');

    await mkdir(new URL('reports', import.meta.url), { recursive: true });
    const report = new URL(`reports/ppt-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
    await writeFile(
      report,
      JSON.stringify(
        {
          model: TEST_MODEL,
          status: deck.status,
          outline: {
            error: outline.runs[0]?.attempt.error,
            nudges: outline.runs[0]?.attempt.nudges,
            tools: outlineTools,
          },
          slides: { error: run?.attempt.error, nudges: run?.attempt.nudges, tools: slideTools },
          asked,
          understanding: deck.understanding,
          pages: deck.slides.map((s) => ({ layout: s.layout, title: s.title, content: s.content, notes: s.notes })),
        },
        null,
        2,
      ),
    );

    expect(outline.runs[0]?.attempt.error).toBeNull();
    expect(outline.slides).toHaveLength(PAGES);
    expect(run?.attempt.error).toBeNull();
    expect(deck.status).toBe(DeckStatus.Ready);
    for (const slide of deck.slides) expect(slideContentSchema.safeParse(slide.content).success).toBe(true);
    // The writer read the code: the deck names functions the fixture really has.
    expect(JSON.stringify(deck.slides.map((s) => s.content))).toMatch(/mean|median/);
  });
});
