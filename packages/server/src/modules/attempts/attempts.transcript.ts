import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ServerEventType,
  TRANSCRIPT_PAGE_SIZE,
  type TranscriptEntry,
  type TranscriptPage,
  transcriptEntrySchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';

/** An entry before the store numbers and timestamps it. */
export type NewTranscriptEntry = TranscriptEntry extends infer E
  ? E extends TranscriptEntry
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;

/** Debug attempts belong to no task; their transcripts live under `runs/debug/`. */
const DEBUG_RUN_DIR = 'debug';

/**
 * Append-only JSONL per attempt at `<data dir>/runs/<taskId>/<attemptId>.jsonl` (10 §3); every appended entry is also
 * pushed as `attempt.transcript`. Appends are synchronous so entries keep the order of the events that produced them.
 */
export function createTranscriptStore({ runsDir, events, clock }: { runsDir: string; events: EventBus; clock: Clock }) {
  const lastSeq = new Map<string, number>();

  const fileOf = (attempt: { id: string; taskId: string | null }) =>
    join(runsDir, attempt.taskId ?? DEBUG_RUN_DIR, `${attempt.id}.jsonl`);

  function readAll(file: string): TranscriptEntry[] {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => transcriptEntrySchema.parse(JSON.parse(line)));
  }

  return {
    append(attempt: { id: string; taskId: string | null }, entries: readonly NewTranscriptEntry[]): void {
      if (entries.length === 0) return;
      const file = fileOf(attempt);
      let seq = lastSeq.get(attempt.id) ?? readAll(file).at(-1)?.seq ?? 0;
      const ts = clock.now();
      const numbered = entries.map((e) => transcriptEntrySchema.parse({ ...e, seq: ++seq, ts }));
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, numbered.map((e) => `${JSON.stringify(e)}\n`).join(''));
      lastSeq.set(attempt.id, seq);
      events.publish({ type: ServerEventType.AttemptTranscript, data: { attemptId: attempt.id, entries: numbered } });
    },

    /**
     * Entries after `afterSeq`, one page at a time. Within a page a streaming part shows once, with its last text, at
     * the position where it started; later pages (and SSE) may repeat the part, which readers replace by `partId`.
     */
    read(attempt: { id: string; taskId: string | null }, afterSeq: number, isEnded: boolean): TranscriptPage {
      const rest = readAll(fileOf(attempt)).filter((e) => e.seq > afterSeq);
      const page = rest.slice(0, TRANSCRIPT_PAGE_SIZE);
      const merged: TranscriptEntry[] = [];
      const indexOfPart = new Map<string, number>();
      for (const entry of page) {
        const partId = 'partId' in entry ? entry.partId : undefined;
        const at = partId === undefined ? undefined : indexOfPart.get(partId);
        if (at !== undefined) {
          merged[at] = entry;
          continue;
        }
        if (partId !== undefined) indexOfPart.set(partId, merged.length);
        merged.push(entry);
      }
      return {
        entries: merged,
        lastSeq: page.at(-1)?.seq ?? afterSeq,
        done: isEnded && rest.length === page.length,
      };
    },
  };
}
export type TranscriptStore = ReturnType<typeof createTranscriptStore>;
