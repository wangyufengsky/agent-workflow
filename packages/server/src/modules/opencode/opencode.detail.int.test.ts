import { createConversationOp, getAssistantContextOp, sendAssistantMessageOp, updateSettingsOp } from '@aw/shared';
import type { Messages } from '@aw/shared/context';
import { expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';

it('助手入口按会话目录查询原窗口，保留尾段，历史预览限长，原生摘要生成的账单不计入活跃水位', async () => {
  const t = await createTestApp();
  try {
    const { body: conversation } = await t.call(createConversationOp, {});
    expect((await t.call(getAssistantContextOp, { id: conversation.id })).body.messages).toEqual([]);
    await t.call(updateSettingsOp, { 'ai.defaultModel': 'opencode/fake-model' });
    const native = vi
      .spyOn(t.fake, 'nativeToolBytes')
      .mockRejectedValueOnce(new Error('Tool list unavailable'))
      .mockResolvedValue(300);
    t.fake.enqueue(script().text('done'));
    await t.call(sendAssistantMessageOp, { id: conversation.id, text: 'test', context: { page: 'home', params: {} } });
    await t.fake.settled();
    const session = t.fake.sessions[0];
    if (!session) throw new Error('Missing assistant session');
    const history = [
      { info: { id: 'old', role: 'user' }, parts: [{ type: 'text', text: 'x'.repeat(9000) }] },
      { info: { id: 'tail', role: 'user' }, parts: [{ type: 'text', text: 'retain me' }] },
      { info: { id: 'mark', role: 'user' }, parts: [{ type: 'compaction', tail_start_id: 'tail' }] },
      {
        info: {
          id: 'summary',
          role: 'assistant',
          parentID: 'mark',
          summary: true,
          finish: 'stop',
          time: { completed: 1 },
          tokens: { input: 50000, cache: { read: 1, write: 1 } },
        },
        parts: [{ type: 'text', text: 'brief' }],
      },
    ] as unknown as Messages;
    const catalog = vi.spyOn(t.fake, 'listModels');
    t.fake.sessionMessages = async ({ sessionId, directory }) => {
      // 历史请求结束前，两个独立的定义查询均已开始。
      await Promise.resolve();
      expect(catalog).toHaveBeenCalledWith(session.directory);
      expect(native).toHaveBeenCalled();
      expect([sessionId, directory]).toEqual([session.id, session.directory]);
      return history;
    };
    const { body } = await t.call(getAssistantContextOp, { id: conversation.id });
    expect(body).toMatchObject({ managed: false, compactions: 1, measuredInput: null, folded: [], summary: null });
    expect(body.historyParts.dialogue).toBeLessThan(100);
    expect(body.historyParts.system).toBeGreaterThan(0);
    expect(body.historyParts.tools).toBeGreaterThan(0);
    const refreshed = () => t.call(getAssistantContextOp, { id: conversation.id });
    expect((await refreshed()).body.historyParts.tools).toBe(body.historyParts.tools + 100);
    expect((await refreshed()).body.historyParts.tools).toBe(body.historyParts.tools + 100);
    expect(native).toHaveBeenCalledTimes(2);
    expect(native).toHaveBeenCalledWith(session.directory, { providerId: 'opencode', modelId: 'fake-model' });
    expect(body.messages[0]).toMatchObject({
      id: 'old',
      status: 'archived',
      sent: false,
      projectedTokens: 0,
      length: 9000,
      truncated: true,
    });
    expect(body.messages[0]?.preview).toHaveLength(8192);
    expect(body.messages.slice(1).map((m) => m.status)).toEqual(['protected', 'protected', 'protected']);
  } finally {
    await t.close();
  }
});
