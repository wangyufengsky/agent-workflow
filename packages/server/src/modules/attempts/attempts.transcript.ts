import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TRANSCRIPT_PAGE_SIZE, type TranscriptEntry, type TranscriptPage, transcriptEntrySchema } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';

/** An entry before the store numbers and timestamps it. */
export type NewTranscriptEntry = TranscriptEntry extends infer E
  ? E extends TranscriptEntry
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;

/**
 * Append-only JSONL, one file per subject (10 §3): attempts at `runs/<taskId>/<attemptId>.jsonl`, assistant
 * conversations at `assistant/conversations/<id>.jsonl`. Every appended entry is also handed to `onAppend`, which
 * pushes it over SSE. Appends are synchronous so entries keep the order of the events that produced them.
 */
export function createTranscriptStore<S extends { id: string }>({
  fileOf,
  onAppend,
  clock,
}: {
  fileOf(subject: S): string;
  onAppend(subject: S, entries: TranscriptEntry[]): void;
  clock: Clock;
}) {
  const lastSeq = new Map<string, number>();

  /**
   * The file's lines, unparsed. `append` numbers entries 1, 2, 3… one per line, so line `i` holds seq `i + 1`: a page
   * is a slice of lines and only its own lines are parsed (a long session's file runs to megabytes).
   */
  function lines(file: string): string[] {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, 'utf8');
    return text === '' ? [] : text.slice(0, -1).split('\n');
  }

  return {
    append(subject: S, entries: readonly NewTranscriptEntry[]): void {
      if (entries.length === 0) return;
      const file = fileOf(subject);
      let seq = lastSeq.get(subject.id) ?? lines(file).length;
      const ts = clock.now();
      const numbered = entries.map((e) => transcriptEntrySchema.parse({ ...e, seq: ++seq, ts }));
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, numbered.map((e) => `${JSON.stringify(e)}\n`).join(''));
      lastSeq.set(subject.id, seq);
      onAppend(subject, numbered);
    },

    /**
     * Entries after `afterSeq`, one page at a time. Within a page a streaming part shows once, with its last text, at
     * the position where it started; later pages (and SSE) may repeat the part, which readers replace by `partId`.
     */
    read(subject: S, afterSeq: number, isEnded: boolean): TranscriptPage {
      const all = lines(fileOf(subject));
      const page = all
        .slice(afterSeq, afterSeq + TRANSCRIPT_PAGE_SIZE)
        .map((line) => transcriptEntrySchema.parse(JSON.parse(line)));
      const hasMore = all.length > afterSeq + page.length;
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
      return { entries: merged, lastSeq: page.at(-1)?.seq ?? afterSeq, hasMore, done: isEnded && !hasMore };
    },

    /** The subject is gone (a deleted conversation); its file is removed by the caller. */
    forget(subject: S): void {
      lastSeq.delete(subject.id);
    },
  };
}
export type TranscriptStore<S extends { id: string }> = ReturnType<typeof createTranscriptStore<S>>;
