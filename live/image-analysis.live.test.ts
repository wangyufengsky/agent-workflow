import { randomBytes } from 'node:crypto';
import {
  ATTACHMENT_NAME_HEADER,
  attachmentSchema,
  createConversationOp,
  getRuntimeOp,
  IMAGE_PROCESSOR_ROLE_KEY,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
  updateRoleOp,
  updateSettingsOp,
} from '@aw/shared';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { createTestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

const TEXT_MODEL = process.env.AW_LIVE_TEXT_MODEL ?? 'opencode-go/glm-5.3';
const VISION_MODEL = process.env.AW_LIVE_IMAGE_MODEL ?? TEST_MODEL;
const TURN_TIMEOUT_MS = 3 * 60_000;

it(
  '@live 纯文本助手通过图像处理员读出只出现在图片中的随机错误码',
  async () => {
    const code = `E-${randomBytes(3).toString('hex').toUpperCase()}`;
    const browser = await chromium.launch();
    let png: Buffer;
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 200 } });
      await page.setContent(`<main style="font: bold 48px sans-serif;padding: 24px">Error: ${code}</main>`);
      png = await page.screenshot();
    } finally {
      await browser.close();
    }

    const t = await createTestApp({ realOpencode: true });
    try {
      await t.app.start(t.port);
      expect((await t.call(getRuntimeOp, {})).body.status).toBe('ready');
      const { available } = await t.app.services.opencode.listModels();
      const model = (name: string) => available.find((m) => `${m.providerId}/${m.modelId}` === name);
      expect(model(TEXT_MODEL), TEXT_MODEL).toMatchObject({ supportsImage: false });
      expect(model(VISION_MODEL), VISION_MODEL).toMatchObject({ supportsImage: true });
      await t.call(updateRoleOp, {
        id: t.app.services.roles.getByKey(IMAGE_PROCESSOR_ROLE_KEY).id,
        model: VISION_MODEL,
      });
      await t.call(updateSettingsOp, { 'ai.defaultModel': TEXT_MODEL });
      const uploaded = await t.request({
        method: 'POST',
        url: '/attachments',
        headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: 'error.png' },
        payload: png,
      });
      expect(uploaded.statusCode).toBe(201);
      const image = attachmentSchema.parse(uploaded.json());
      const { body: conversation } = await t.call(createConversationOp, {});
      const idle = waitForEvent(
        t.app.events,
        ServerEventType.AssistantUpdated,
        (item) => item.id === conversation.id && !item.busy,
        TURN_TIMEOUT_MS,
      );
      expect(
        (
          await t.call(sendAssistantMessageOp, {
            id: conversation.id,
            text: '请读出附图里的错误码，按原样引用。',
            context: { page: 'home', params: {} },
            attachmentIds: [image.id],
          })
        ).status,
      ).toBe(200);
      await idle;
      const transcript: TranscriptPage = (
        await t.request({
          method: 'GET',
          url: `/assistant/conversations/${conversation.id}/transcript`,
        })
      ).json();
      const tools = transcript.entries.flatMap((entry) => (entry.kind === 'tool_call' ? [entry.data.tool] : []));
      const reply = transcript.entries.flatMap((entry) => (entry.kind === 'text' ? [entry.data.text] : [])).join('\n');
      expect(tools).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}analyze_image`);
      expect(reply).toContain(code);
    } finally {
      await t.close();
    }
  },
  TURN_TIMEOUT_MS + 30_000,
);
