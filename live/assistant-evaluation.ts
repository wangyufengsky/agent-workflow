import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  type AssistantPageRef,
  AssistantTurnEvent,
  AssistantTurnStatus,
  createConversationOp,
  getConversationOp,
  getRuntimeOp,
  mergePiece,
  type ServerEvent,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptEntry,
  TranscriptEntryKind,
  transcriptEntrySchema,
  updateSettingsOp,
} from '@aw/shared';
import { expect } from 'vitest';
import type { BrowserHost } from '../packages/server/src/modules/browser/index.ts';
import type { OpencodeEvent } from '../packages/server/src/modules/opencode/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';
import {
  identityOf,
  latestTurnId,
  type NativeTurnSnapshot,
  nativeTurnSnapshot,
  newUserTurnId,
  scopedEntries,
  statusOf,
  transcriptCaughtUp,
} from './assistant-turn-evidence.ts';

export const TURN_TIMEOUT_MS = 5 * 60_000;
export const HOME = { page: 'home', params: {} } as const;

/** 还原真正的流式增量，不能只取同 partId 的最后一行（D104）。 */
export function replyOf(entries: readonly TranscriptEntry[]): string {
  const parts = new Map<string, { text: string; offset: number }>();
  for (const entry of entries) {
    if (entry.kind !== TranscriptEntryKind.Text) continue;
    const before = parts.get(entry.partId);
    parts.set(entry.partId, before === undefined ? entry.data : mergePiece(before, entry.data));
  }
  return [...parts.values()].map((part) => part.text).join('\n');
}

export function toolCalls(entries: readonly TranscriptEntry[]) {
  return entries.flatMap((entry) => (entry.kind === TranscriptEntryKind.ToolCall ? [entry.data] : []));
}

export function toolResults(entries: readonly TranscriptEntry[]) {
  return entries.flatMap((entry) => (entry.kind === TranscriptEntryKind.ToolResult ? [entry.data] : []));
}

/** 监听先于动作，无轮询、sleep 或自动重试；每个退出路径移除订阅和截止计时器。 */
export async function during<T>(
  t: TestApp,
  predicate: (event: ServerEvent) => boolean,
  action: () => Promise<T>,
  timeoutMs = TURN_TIMEOUT_MS,
): Promise<T> {
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const event = new Promise<void>((resolve, reject) => {
    unsubscribe = t.app.events.subscribe((value) => {
      try {
        if (predicate(value)) resolve();
      } catch (error) {
        reject(error);
      }
    });
    timer = setTimeout(() => reject(new Error(`Expected live event within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const [result] = await Promise.all([action(), event]);
    return result;
  } finally {
    unsubscribe();
    clearTimeout(timer);
  }
}

export async function startAssistantEvaluation(name: string, browserHost?: BrowserHost) {
  const t = await createTestApp({ realOpencode: true, ...(browserHost === undefined ? {} : { browserHost }) });
  const startedAt = Date.now();
  const evidenceDb = new DatabaseSync(join(t.dataDir, 'app.db'), { readOnly: true });
  const nativeEvents: OpencodeEvent[] = [];
  const unsubscribeNative = t.app.services.opencode.subscribe((event) => nativeEvents.push(event));
  const conversations = new Set<string>();
  const tasks = new Set<string>();
  const events: ServerEvent[] = [];
  const turns: unknown[] = [];
  const facts: Record<string, unknown> = {};
  const reportDir = new URL(
    `reports/assistant-${name}-${new Date().toISOString().replaceAll(':', '-')}/`,
    import.meta.url,
  );
  await mkdir(reportDir, { recursive: true });
  const unsubscribe = t.app.events.subscribe((event) => events.push(event));
  await t.app.start(t.port);
  expect((await t.call(getRuntimeOp, {})).body.status).toBe('ready');
  expect((await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL })).status).toBe(200);

  async function entries(id: string): Promise<TranscriptEntry[]> {
    const file = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR, `${id}.jsonl`);
    try {
      return (await readFile(file, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => transcriptEntrySchema.parse(JSON.parse(line)));
    } catch (error) {
      // 还没有第一条消息的会话没有 JSONL。
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function checkpoint(
    label: string,
    id: string,
    afterSeq: number,
    begun = Date.now(),
    snapshot?: NativeTurnSnapshot,
  ) {
    const windowEntries = (await entries(id)).filter((entry) => entry.seq > afterSeq);
    const raw = snapshot === undefined ? windowEntries : scopedEntries(snapshot, windowEntries);
    const state = (await t.call(getConversationOp, { id })).body;
    const report = {
      label,
      conversationId: id,
      elapsedMs: Date.now() - begun,
      reply: replyOf(raw),
      tools: toolCalls(raw),
      results: toolResults(raw),
      errors: windowEntries.filter((entry) => entry.kind === TranscriptEntryKind.Error),
      state,
      entries: raw,
      windowEntries,
      nativeSnapshot: snapshot,
    };
    turns.push(report);
    await writeFile(new URL('turns.json', reportDir), JSON.stringify(turns, null, 2));
    return report;
  }

  /** 用终态原生 parts 等待应用 SSE/JSONL 收齐；由真实事件唤醒，不 sleep、不轮询。 */
  async function completeEvidence(id: string, turnId: number, afterSeq: number): Promise<NativeTurnSnapshot> {
    expect(statusOf(evidenceDb, id, turnId)).toBe(AssistantTurnStatus.Completed);
    const identity = identityOf(evidenceDb, id, turnId);
    expect(identity.endReason).toBe(AssistantTurnEvent.Idle);
    const snapshot = await nativeTurnSnapshot(t, id, identity);
    expect(snapshot.messages.length).toBeGreaterThan(0);
    for (const message of snapshot.messages) {
      if (message.info.role === 'assistant') expect(message.info.error).toBeUndefined();
    }
    const observed = () =>
      events.flatMap((event) =>
        event.type === ServerEventType.AssistantTranscript && event.data.conversationId === id
          ? event.data.entries.filter((entry) => entry.seq > afterSeq)
          : [],
      );
    let offApp = () => {};
    let offNative = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          try {
            expect(observed().filter((entry) => entry.kind === TranscriptEntryKind.Error)).toEqual([]);
            if (transcriptCaughtUp(snapshot, observed(), nativeEvents)) resolve();
          } catch (error) {
            reject(error);
          }
        };
        offApp = t.app.events.subscribe(check);
        offNative = t.app.services.opencode.subscribe(check);
        timer = setTimeout(
          () => reject(new Error(`Turn ${turnId} SSE did not match native final parts`)),
          TURN_TIMEOUT_MS,
        );
        check();
      });
    } finally {
      offApp();
      offNative();
      clearTimeout(timer);
    }
    const current = (await t.call(getConversationOp, { id })).body;
    if (current.usage.latest?.id === turnId) {
      expect(current.usage.latest).toMatchObject({
        status: AssistantTurnStatus.Completed,
        endReason: AssistantTurnEvent.Idle,
      });
    }
    return snapshot;
  }

  return {
    t,
    events,
    facts,
    tasks,
    reportDir,
    entries,
    checkpoint,
    async completedCheckpoint(label: string, id: string, afterSeq: number, begun = Date.now()) {
      const snapshot = await completeEvidence(id, latestTurnId(evidenceDb, id), afterSeq);
      return checkpoint(label, id, afterSeq, begun, snapshot);
    },
    async conversation(title: string) {
      const result = await t.call(createConversationOp, { title });
      expect(result.status).toBe(201);
      conversations.add(result.body.id);
      return result.body.id;
    },
    async turn(
      id: string,
      label: string,
      text: string,
      options: { attachmentIds?: string[]; context?: AssistantPageRef } = {},
    ) {
      const afterSeq = (await entries(id)).at(-1)?.seq ?? 0;
      const previousTurnId = latestTurnId(evidenceDb, id);
      const begun = Date.now();
      let snapshot: NativeTurnSnapshot | undefined;
      try {
        await during(
          t,
          () => {
            const turnId = newUserTurnId(evidenceDb, id, previousTurnId);
            return turnId !== undefined && statusOf(evidenceDb, id, turnId) !== AssistantTurnStatus.Running;
          },
          async () => {
            const response = await t.call(sendAssistantMessageOp, {
              id,
              text,
              context: options.context ?? HOME,
              ...(options.attachmentIds === undefined ? {} : { attachmentIds: options.attachmentIds }),
            });
            expect(response.status, response.raw.body).toBe(200);
          },
        );
        const turnId = newUserTurnId(evidenceDb, id, previousTurnId);
        if (turnId === undefined) throw new Error('Expected the persisted user turn');
        snapshot = await completeEvidence(id, turnId, afterSeq);
      } finally {
        await checkpoint(label, id, afterSeq, begun, snapshot);
      }
      const raw = scopedEntries(
        snapshot,
        (await entries(id)).filter((entry) => entry.seq > afterSeq),
      );
      expect(
        (await entries(id)).filter((entry) => entry.seq > afterSeq && entry.kind === TranscriptEntryKind.Error),
      ).toEqual([]);
      return { entries: raw, reply: replyOf(raw), tools: toolCalls(raw), results: toolResults(raw) };
    },
    async close() {
      try {
        const states = await Promise.all(
          [...conversations].map(async (id) => (await t.call(getConversationOp, { id })).body),
        );
        for (const id of conversations) {
          const raw = await entries(id);
          await writeFile(new URL(`${id}.jsonl`, reportDir), raw.map((entry) => JSON.stringify(entry)).join('\n'));
        }
        for (const taskId of tasks) {
          const directory = join(t.dataDir, 'runs', taskId);
          let files: string[];
          try {
            files = await readdir(directory);
          } catch (error) {
            // 创建/启动失败时可能尚无执行目录；报告原始失败，不让收集证据的 ENOENT 覆盖它。
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            facts[`missingTaskRuns:${taskId}`] = directory;
            continue;
          }
          for (const file of files.filter((file) => file.endsWith('.jsonl'))) {
            await writeFile(new URL(`${taskId}-${file}`, reportDir), await readFile(join(directory, file)));
          }
        }
        await writeFile(
          new URL('report.json', reportDir),
          JSON.stringify(
            {
              model: TEST_MODEL,
              startedAt,
              elapsedMs: Date.now() - startedAt,
              dataDir: t.dataDir,
              states,
              facts,
              turns,
              events,
              nativeEvents,
              logs: t.logs,
            },
            null,
            2,
          ),
        );
        console.info(`Assistant evaluation report: ${reportDir.pathname}`);
      } finally {
        unsubscribe();
        unsubscribeNative();
        evidenceDb.close();
        await t.close();
      }
    },
  };
}
export type AssistantEvaluation = Awaited<ReturnType<typeof startAssistantEvaluation>>;
