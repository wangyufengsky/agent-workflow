import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ServerEventType,
  startDebugAttemptOp,
  TRANSCRIPT_PAGE_SIZE,
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

    // The long text was flushed while streaming, then once more when complete; SSE carried the same lines.
    const lines = (await readFile(join(t.dataDir, 'runs', 'debug', `${attempt.id}.jsonl`), 'utf8')).trim().split('\n');
    const textLines = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === 'text');
    expect(textLines.length).toBeGreaterThan(2);
    expect(new Set(textLines.map((e) => e.partId)).size).toBe(1);
    expect(streamed.map((e) => e.seq)).toEqual(lines.map((l) => JSON.parse(l).seq));
  });

  it('按 afterSeq 分页，最后一页 done', async () => {
    let turn = script();
    for (let i = 0; i < TRANSCRIPT_PAGE_SIZE; i++) turn = turn.text(`line ${i}`);
    const attempt = await runAttempt(turn);

    const first = await page(attempt.id, 0);
    expect(first.entries).toHaveLength(TRANSCRIPT_PAGE_SIZE);
    expect(first).toMatchObject({ lastSeq: TRANSCRIPT_PAGE_SIZE, done: false });

    const second = await page(attempt.id, first.lastSeq);
    expect(second.entries[0]?.seq).toBe(TRANSCRIPT_PAGE_SIZE + 1);
    expect(kinds(second.entries)).toEqual(['text', 'text', 'tool_call', 'tool_result', 'system']);
    expect(second.done).toBe(true);

    expect(await page(attempt.id, second.lastSeq)).toEqual({ entries: [], lastSeq: second.lastSeq, done: true });
  });

  it('不存在的尝试返回 404 ATTEMPT_NOT_FOUND', async () => {
    const res = await t.request({ url: `/attempts/nope/transcript` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'ATTEMPT_NOT_FOUND' } });
  });
});
