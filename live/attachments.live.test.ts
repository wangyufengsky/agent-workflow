import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_PROMPT_MAX_CHARS,
  type AttachmentDTO,
  createConversationOp,
  getRuntimeOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** U-02 / U-03: a real model reads an attachment the prompt shows only in part (30 §3.2), the free test model. */
const TURN_TIMEOUT_MS = 5 * 60_000;
const PASSPHRASE = '蓝鲸-4721';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
}, 60_000);
afterAll(() => t.close());

describe('@live 附件', () => {
  it('长附件的结尾不在提示词里：助手用 read_attachment 读到它并据此回答', async () => {
    // Longer than the prompt takes, so its end — and the passphrase — is only reachable with read_attachment.
    const lines = Array.from({ length: 1200 }, (_, i) => `第 ${i + 1} 行：订单服务例行日志，没有异常。`);
    const content = `${lines.join('\n')}\n暗号：${PASSPHRASE}\n`;
    expect(content.length).toBeGreaterThan(ATTACHMENT_PROMPT_MAX_CHARS);
    const res = await t.request({
      method: 'POST',
      url: '/attachments',
      headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: 'order-service.log' },
      payload: content,
    });
    const attachment = res.json<AttachmentDTO>();

    const { body: conversation } = await t.call(createConversationOp, {});
    const idle = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === conversation.id && !c.busy,
      TURN_TIMEOUT_MS,
    );
    await t.call(sendAssistantMessageOp, {
      id: conversation.id,
      text: '附件日志的最后一行写了一个暗号，告诉我暗号是什么。',
      context: { page: 'home', params: {} },
      attachmentIds: [attachment.id],
    });
    await idle;

    const file = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR, `${conversation.id}.jsonl`);
    const entries: TranscriptEntry[] = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const tools = entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : []));
    const parts = new Map(entries.flatMap((e) => (e.kind === 'text' ? [[e.partId, e.data.text] as const] : [])));
    const reply = [...parts.values()].join('\n');
    const errors = entries.filter((e) => e.kind === 'error');
    await mkdir(new URL('reports', import.meta.url), { recursive: true });
    const report = new URL(
      `reports/attachments-${new Date().toISOString().replaceAll(':', '-')}.json`,
      import.meta.url,
    );
    await writeFile(report, JSON.stringify({ model: TEST_MODEL, tools, reply, errors }, null, 2));

    expect(errors).toEqual([]);
    expect(tools).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}read_attachment`);
    expect(reply).toContain(PASSPHRASE);
  });
});
