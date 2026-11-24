import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  COMPANION_WHISPER_MAX_CHARS,
  COMPANION_WHISPER_TIMEOUT_MS,
  ErrorCode,
  modelEfforts,
  OPENCODE_COMPANION_AGENT,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import {
  OpencodeEventType as E,
  type OpencodeClient,
  parseModelRef,
  type SessionDispatcher,
  SessionPurpose,
} from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';

/** 碎碎念每次使用独立的无工具会话，完成／失败／取消后删除，工作会话不接收这些消息。 */
export function createWhisperService(deps: {
  opencode: OpencodeClient;
  settings: SettingsService;
  clock: Clock;
  sessions: SessionDispatcher;
  dataDir: string;
}) {
  const { opencode, settings, clock, sessions } = deps;
  const directory = join(deps.dataDir, 'companion');
  let active: { abort: AbortController; settled: Promise<void> } | undefined;
  return {
    async generate(): Promise<{ text: string }> {
      if (active !== undefined) throw new AppError(ErrorCode.AssistantBusy, 'Companion is already speaking');
      const abort = new AbortController();
      const completed = Promise.withResolvers<void>();
      active = { abort, settled: completed.promise };
      try {
        return await sessions.callPrepared(
          {
            directory,
            title: 'companion whisper',
            purpose: SessionPurpose.Companion,
            signal: abort.signal,
          },
          async ({ sessionId, signal }) => {
            const result = Promise.withResolvers<{ text: string }>();
            const roles = new Set<string>();
            const parts = new Map<string, string>();
            const unsubscribe = opencode.subscribe((event) => {
              if (event.type === E.RuntimeLost) {
                result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Runtime stopped during whisper'));
                return;
              }
              if (event.sessionId !== sessionId) return;
              if (event.type === E.Message && event.role === 'assistant') roles.add(event.messageId);
              if (event.type === E.Text && event.kind === 'text' && roles.has(event.messageId))
                parts.set(event.partId, event.text);
              if (event.type === E.TextDelta && parts.has(event.partId))
                parts.set(event.partId, parts.get(event.partId) + event.delta);
              if (event.type === E.Error || event.type === E.PermissionAsked || event.type === E.Tool) {
                result.reject(
                  new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation failed or attempted a tool'),
                );
              }
              if (event.type === E.Idle) {
                const text = [...parts.values()].join('').trim();
                if (text.length === 0 || text.length > COMPANION_WHISPER_MAX_CHARS)
                  result.reject(
                    new AppError(ErrorCode.OpencodeRequestFailed, 'Companion returned invalid text length'),
                  );
                else result.resolve({ text });
              }
            });
            const cancel = () =>
              result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation cancelled'));
            signal.addEventListener('abort', cancel, { once: true });
            const clearTimeout = clock.schedule(COMPANION_WHISPER_TIMEOUT_MS, () =>
              result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation timed out')),
            );
            const model = settings.get('ai.defaultModel');
            // 先连接 rejection handler，再开始可能同步产生事件的适配器。
            const pending = result.promise;
            if (signal.aborted) cancel();
            else
              void opencode
                .prompt({
                  sessionId,
                  directory,
                  agent: OPENCODE_COMPANION_AGENT,
                  efforts: modelEfforts(settings.getAll()),
                  ...(model === null ? {} : { model: parseModelRef(model) }),
                  text: '请随口说一句日常碎碎念。',
                  system: `Current local time: ${new Date(clock.now()).toISOString()}.`,
                })
                .catch(result.reject);
            try {
              return await pending;
            } finally {
              clearTimeout();
              unsubscribe();
              signal.removeEventListener('abort', cancel);
            }
          },
          async () => mkdir(directory, { recursive: true }),
        );
      } catch (error) {
        if (abort.signal.aborted) throw new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation cancelled');
        throw error;
      } finally {
        active = undefined;
        completed.resolve();
      }
    },
    async stop(): Promise<void> {
      const current = active;
      current?.abort.abort();
      await current?.settled;
    },
  };
}
export type WhisperService = ReturnType<typeof createWhisperService>;
