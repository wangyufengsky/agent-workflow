import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ServerEventType,
  startDebugAttemptOp,
  TRANSCRIPT_PAGE_SIZE,
  TRANSCRIPT_TEXT_FLUSH_CHARS,
  type TranscriptEntry,
  type TranscriptPage,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeScript, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

/** Starts a debug attempt playing `turn` and waits until it has ended. */
async function runAttempt(turn: FakeScript) {
  t.fake.enqueue(turn.callTool('submit_result', { summary: 'done' }));
  const ended = waitForEvent(t.app.events, ServerEventType.AttemptUpdated, (d) => d.attempt.status === 'succeeded');
  const repo = await createTestRepo();
  const { body: attempt } = await t.call(startDebugAttemptOp, { directory: repo.path, requirement: 'Explain' });
  await ended;
  await t.fake.settled();
  return attempt;
}

async function page(attemptId: string, afterSeq: number): Promise<TranscriptPage> {
  const res = await t.request({ url: `/attempts/${attemptId}/transcript?afterSeq=${afterSeq}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** FakeOpencode streams 8 characters at a time, so a line may overshoot the flush size by that much. */
const DELTA = 8;

const kinds = (entries: TranscriptEntry[]) => entries.map((e) => e.kind);

describe('会话流', () => {
  it('流式正文按片段合并为一条完整文本，JSONL 中保留每次写入', async () => {
    const answer = `${'The change adds a greeting. '.repeat(20)}Done.`;
    const streamed: TranscriptEntry[] = [];
    const unsubscribe = t.app.events.subscribe((e) => {
      if (e.type === ServerEventType.AttemptTranscript) streamed.push(...e.data.entries);
    });
    const attempt = await runAttempt(script().text(answer));
    unsubscribe();

    const { entries, done } = await page(attempt.id, 0);
    expect(kinds(entries)).toEqual(['system', 'user_message', 'text', 'tool_call', 'tool_result', 'system']);
    expect(entries[2]).toMatchObject({ kind: 'text', data: { text: answer } });
    expect(done).toBe(true);

    // While streaming, each line holds only what the text grew by (D104); SSE carried the same lines.
    const lines = (await readFile(join(t.dataDir, 'runs', 'debug', `${attempt.id}.jsonl`), 'utf8')).trim().split('\n');
    const textLines = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === 'text');
    expect(textLines.length).toBeGreaterThan(answer.length / (TRANSCRIPT_TEXT_FLUSH_CHARS + DELTA));
    expect(new Set(textLines.map((e) => e.partId)).size).toBe(1);
    expect(textLines.map((e) => e.data.text).join('')).toBe(answer);
    expect(textLines.map((e) => e.data.offset)).toEqual(
      textLines.map((_, i) => textLines.slice(0, i).reduce((n, e) => n + e.data.text.length, 0)),
    );
    expect(streamed.map((e) => e.seq)).toEqual(lines.map((l) => JSON.parse(l).seq));
  });

  it('跨页的流式思考在后一页接着合并', async () => {
    let turn = script();
    for (let i = 0; i < TRANSCRIPT_PAGE_SIZE - 3; i++) turn = turn.text(`line ${i}`);
    const thought = 'Checking the loop bound before editing. '.repeat(10);
    const attempt = await runAttempt(turn.think(thought));

    const first = await page(attempt.id, 0);
    const second = await page(attempt.id, first.lastSeq);
    const pieces = [...first.entries, ...second.entries].filter((e) => e.kind === 'reasoning');
    expect(pieces).toHaveLength(2);
    // The second page's piece continues from where the first one stopped.
    const full = pieces.reduce(
      (text, e) => (e.kind === 'reasoning' ? text.slice(0, e.data.offset) + e.data.text : text),
      '',
    );
    expect(full).toBe(thought);
  });

  it('按 afterSeq 分页，最后一页 done', async () => {
    let turn = script();
    for (let i = 0; i < TRANSCRIPT_PAGE_SIZE; i++) turn = turn.text(`line ${i}`);
    const attempt = await runAttempt(turn);

    const first = await page(attempt.id, 0);
    expect(first.entries).toHaveLength(TRANSCRIPT_PAGE_SIZE);
    expect(first).toMatchObject({ lastSeq: TRANSCRIPT_PAGE_SIZE, hasMore: true, done: false });

    const second = await page(attempt.id, first.lastSeq);
    expect(second.entries[0]?.seq).toBe(TRANSCRIPT_PAGE_SIZE + 1);
    expect(kinds(second.entries)).toEqual(['text', 'text', 'tool_call', 'tool_result', 'system']);
    expect(second).toMatchObject({ hasMore: false, done: true });

    expect(await page(attempt.id, second.lastSeq)).toEqual({
      entries: [],
      lastSeq: second.lastSeq,
      hasMore: false,
      done: true,
    });
  });

  it('不存在的尝试返回 404 ATTEMPT_NOT_FOUND', async () => {
    const res = await t.request({ url: `/attempts/nope/transcript` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'ATTEMPT_NOT_FOUND' } });
  });
});
