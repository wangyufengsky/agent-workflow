import { mkdir, writeFile } from 'node:fs/promises';
import {
  createConversationOp,
  getRuntimeOp,
  listConversationsOp,
  ServerEventType,
  sendAssistantMessageOp,
  updateSettingsOp,
  whisperOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

it('@live 桌宠碎碎念与 desktop 来源真实助手对话', async () => {
  const t = await createTestApp({ realOpencode: true });
  try {
    await t.app.start(t.port);
    expect((await t.call(getRuntimeOp, {})).body.status).toBe('ready');
    await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
    const whisper = await t.call(whisperOp, {});
    expect(whisper.status).toBe(200);
    expect(whisper.body.text.length).toBeGreaterThan(0);
    expect((await t.call(listConversationsOp, {})).body.items).toEqual([]);
    const { body: conversation } = await t.call(createConversationOp, {});
    const idle = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === conversation.id && !c.busy,
      120_000,
    );
    const sent = await t.call(sendAssistantMessageOp, {
      id: conversation.id,
      text: '这是桌宠连接测试，请只回复：桌宠对话已连通。不需要调用工具。',
      context: { page: 'desktop', params: {} },
    });
    expect(sent.status).toBe(200);
    await idle;
    const transcript = await t.request({
      method: 'GET',
      url: `/assistant/conversations/${conversation.id}/transcript`,
    });
    const result = transcript.json();
    expect(result.entries.some((entry: { kind: string }) => entry.kind === 'error')).toBe(false);
    expect(
      result.entries.some(
        (entry: { kind: string; data: { text?: string } }) =>
          entry.kind === 'text' && entry.data.text?.includes('桌宠对话已连通'),
      ),
    ).toBe(true);
    await mkdir(new URL('reports/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('reports/companion.json', import.meta.url),
      JSON.stringify({ model: TEST_MODEL, whisper: whisper.body, transcript: result }, null, 2),
    );
  } finally {
    await t.close();
  }
}, 180_000);
