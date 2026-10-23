import {
  COMPANION_WHISPER_TIMEOUT_MS,
  ErrorCode,
  listConversationsOp,
  OPENCODE_COMPANION_AGENT,
  stopWhisperOp,
  updateSettingsOp,
  whisperOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { OpencodeEventType } from '../opencode/index.ts';

let t: TestApp;
const clock = createFakeClock();
beforeEach(async () => {
  t = await createTestApp({ clock });
});
afterEach(async () => {
  await t.close();
});
const started = () =>
  new Promise<void>((resolve) => {
    const off = t.fake.subscribe((event) => {
      if (event.type === OpencodeEventType.Message) {
        off();
        resolve();
      }
    });
  });

describe('独立、无工具的碎碎念', () => {
  it('退出应用先取消生成并删除临时会话，再关闭运行时', async () => {
    t.fake.enqueue(script().hang(), { agent: OPENCODE_COMPANION_AGENT });
    const begins = started();
    const pending = t.call(whisperOp, {});
    await begins;
    await t.app.close();
    expect((await pending).body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
    expect(t.fake.sessions).toEqual([]);
  });
  it('沿用模型设置，返回文本后删除临时会话，不增加工作聊天', async () => {
    await t.call(updateSettingsOp, { 'ai.defaultModel': 'provider/companion' });
    t.fake.enqueue(script().text('休息一下，我帮你看着进度。'), { agent: OPENCODE_COMPANION_AGENT });
    const result = await t.call(whisperOp, {});
    expect(result.body).toEqual({ text: '休息一下，我帮你看着进度。' });
    expect(t.fake.prompts[0]).toMatchObject({
      agent: OPENCODE_COMPANION_AGENT,
      model: { providerId: 'provider', modelId: 'companion' },
    });
    expect(t.fake.sessions).toEqual([]);
    expect((await t.call(listConversationsOp, {})).body.items).toEqual([]);
  });
  it('并发被拒绝；取消释放会话，下一次仍能生成', async () => {
    t.fake.enqueue(script().hang(), { agent: OPENCODE_COMPANION_AGENT });
    const begins = started();
    const pending = t.call(whisperOp, {});
    await begins;
    expect(t.fake.sessions[0]?.permission).toEqual([{ permission: '*', pattern: '*', action: 'deny' }]);
    expect((await t.call(whisperOp, {})).body).toMatchObject({ error: { code: ErrorCode.AssistantBusy } });
    expect((await t.call(stopWhisperOp, {})).status).toBe(204);
    expect((await pending).body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
    expect(t.fake.sessions).toEqual([]);
    t.fake.enqueue(script().text('我回来啦。'), { agent: OPENCODE_COMPANION_AGENT });
    expect((await t.call(whisperOp, {})).body).toEqual({ text: '我回来啦。' });
  });
  it('模型无响应会超时，工具调用与空输出明确失败并清理', async () => {
    t.fake.enqueue(script().hang(), { agent: OPENCODE_COMPANION_AGENT });
    const begins = started();
    const pending = t.call(whisperOp, {});
    await begins;
    clock.advance(COMPANION_WHISPER_TIMEOUT_MS);
    expect((await pending).body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
    t.fake.enqueue(script().requestPermission('read', ['*']), { agent: OPENCODE_COMPANION_AGENT });
    expect((await t.call(whisperOp, {})).body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
    expect((await t.call(whisperOp, {})).body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
    expect(t.fake.sessions).toEqual([]);
  });
});
