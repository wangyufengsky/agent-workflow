import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  COMPANION_WHISPER_MAX_CHARS,
  COMPANION_WHISPER_TIMEOUT_MS,
  ErrorCode,
  OPENCODE_COMPANION_AGENT,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import { OpencodeEventType as E, type OpencodeClient, parseModelRef } from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';

/** 碎碎念每次使用独立的无工具会话，完成／失败／取消后删除，工作会话不接收这些消息。 */
export function createWhisperService(deps: {
  opencode: OpencodeClient;
  settings: SettingsService;
  clock: Clock;
  slots: Pick<ModelSlots, 'isFree'>;
  dataDir: string;
}) {
  const { opencode, settings, clock } = deps;
  const directory = join(deps.dataDir, 'companion');
  let running = false;
  let cancel: (() => void) | undefined;
  let settled: Promise<void> = Promise.resolve();
  return {
    async generate(): Promise<{ text: string }> {
      if (running) throw new AppError(ErrorCode.AssistantBusy, 'Companion is already speaking');
      // Not worth a place in line behind real work (D186); it is not counted while it runs either, being one line.
      if (!deps.slots.isFree()) throw new AppError(ErrorCode.ModelSlotsFull, 'Every model slot is taken');
      running = true;
      const completed = Promise.withResolvers<void>();
      settled = completed.promise;
      let sessionId: string | undefined;
      let unsubscribe = () => {};
      let clearTimeout = () => {};
      const result = Promise.withResolvers<{ text: string }>();
      // 取消可能发生在 mkdir／createSession 期间；等建立监听后再拒绝，避免未处理的 Promise。
      let cancelled = false;
      cancel = () => {
        cancelled = true;
      };
      try {
        await mkdir(directory, { recursive: true });
        sessionId = await opencode.createSession({
          directory,
          title: 'companion whisper',
          agent: OPENCODE_COMPANION_AGENT,
          permission: [{ permission: '*', pattern: '*', action: 'deny' }],
        });
        const roles = new Set<string>();
        const parts = new Map<string, string>();
        unsubscribe = opencode.subscribe((event) => {
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
              result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion returned invalid text length'));
            else result.resolve({ text });
          }
        });
        cancel = () => {
          cancelled = true;
          result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation cancelled'));
        };
        clearTimeout = clock.schedule(COMPANION_WHISPER_TIMEOUT_MS, () =>
          result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation timed out')),
        );
        const model = settings.get('ai.defaultModel');
        // 先连接 rejection handler，再开始可能同步产生事件的适配器。
        const pending = result.promise;
        if (cancelled) result.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'Companion generation cancelled'));
        else
          void opencode
            .prompt({
              sessionId,
              directory,
              agent: OPENCODE_COMPANION_AGENT,
              ...(model === null ? {} : { model: parseModelRef(model) }),
              text: '请随口说一句日常碎碎念。',
              system: `Current local time: ${new Date(clock.now()).toISOString()}.`,
            })
            .catch(result.reject);
        return await pending;
      } finally {
        clearTimeout();
        unsubscribe();
        cancel = undefined;
        try {
          if (sessionId !== undefined && opencode.isConnected()) {
            await opencode.abort({ sessionId, directory });
            await opencode.deleteSession({ sessionId, directory });
          }
        } finally {
          running = false;
          completed.resolve();
        }
      }
    },
    async stop(): Promise<void> {
      cancel?.();
      await settled;
    },
  };
}
export type WhisperService = ReturnType<typeof createWhisperService>;
