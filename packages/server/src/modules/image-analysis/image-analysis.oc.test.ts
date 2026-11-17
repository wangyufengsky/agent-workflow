import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ATTACHMENT_NAME_HEADER,
  createConversationOp,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { WHITE_PNG_BASE64 } from '../../../test/fixtures/white-png.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';

const TEXT_MODEL = 'aw-image-test/text';
const VISION_MODEL = 'aw-image-test/vision';
const TOOL = 'agent-workflow-app_analyze_image';
const QUESTION = 'What color is the picture?';
const OBSERVATION = 'The image is white.';
const bodySchema = z.object({
  model: z.string(),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z
        .union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
              image_url: z.object({ url: z.string() }).optional(),
            }),
          ),
        ])
        .nullable(),
    }),
  ),
});

async function requestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return bodySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

it('@opencode 纯文本助手加载识图 Skill，经 MCP 发送原图给视觉模型，再收到文字结果继续回答', async () => {
  const seen: Array<z.infer<typeof bodySchema>> = [];
  let attachmentId: string | undefined;
  let toolCalls = 0;
  const requestErrors: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await requestBody(req);
      seen.push(body);
      const raw = JSON.stringify(body.messages);
      const turn =
        body.model === 'text' && raw.includes(QUESTION) && body.tools.some((item) => item.function.name === TOOL);
      const step = turn ? ++toolCalls : 0;
      const tool =
        step === 1
          ? { name: 'skill', args: { name: 'aw-image-analysis' } }
          : step === 2
            ? { name: TOOL, args: { source: { attachment_id: attachmentId }, question: QUESTION } }
            : undefined;
      const reply = body.model === 'vision' || raw.includes(OBSERVATION) ? OBSERVATION : 'No visual evidence received';
      const delta =
        tool === undefined
          ? { role: 'assistant', content: reply }
          : {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${seen.length}`,
                  type: 'function',
                  function: { name: tool.name, arguments: JSON.stringify(tool.args) },
                },
              ],
            };
      const base = { id: 'image-test', created: 0, model: body.model, object: 'chat.completion.chunk' };
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: tool === undefined ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
    })().catch((err: unknown) => {
      requestErrors.push(String(err));
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let t: TestApp | undefined;
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
    const config = join(await mkdtemp(join(tmpdir(), 'aw-image-model-')), 'opencode.json');
    await writeFile(
      config,
      JSON.stringify({
        enabled_providers: ['aw-image-test'],
        provider: {
          'aw-image-test': {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'unused' },
            models: {
              text: { name: 'Text', tool_call: true },
              vision: { name: 'Vision', attachment: true, modalities: { input: ['text', 'image'], output: ['text'] } },
            },
          },
        },
      }),
    );
    t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: config } });
    await t.app.start(t.port);
    expect(
      (await t.call(updateSettingsOp, { 'ai.imageModel': VISION_MODEL, 'ai.defaultModel': TEXT_MODEL })).status,
    ).toBe(200);
    const uploaded = await t.request({
      method: 'POST',
      url: '/attachments',
      headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: 'screen.png' },
      payload: Buffer.from(WHITE_PNG_BASE64, 'base64'),
    });
    expect(uploaded.statusCode).toBe(201);
    attachmentId = z.object({ id: z.string() }).parse(uploaded.json()).id;
    const { body: conversation } = await t.call(createConversationOp, {});
    const idle = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === conversation.id && !c.busy,
      60_000,
    );
    expect(
      (
        await t.call(sendAssistantMessageOp, {
          id: conversation.id,
          text: QUESTION,
          attachmentIds: [attachmentId],
          context: { page: 'home', params: {} },
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
    expect(requestErrors).toEqual([]);
    const vision = seen.filter((body) => body.model === 'vision');
    expect(vision, JSON.stringify(transcript.entries)).toHaveLength(1);
    expect(vision[0]?.tools).toEqual([]);
    expect(vision[0]?.messages.filter((message) => message.role === 'user')).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: QUESTION },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${WHITE_PNG_BASE64}` } },
        ],
      },
    ]);
    const parent = seen.filter((body) => body.model === 'text').map((body) => JSON.stringify(body));
    expect(parent.some((raw) => raw.includes('Cite the source in your answer or work report.'))).toBe(true);
    expect(parent.some((raw) => raw.includes(OBSERVATION) && raw.includes(TOOL))).toBe(true);
    expect(parent.every((raw) => !raw.includes(WHITE_PNG_BASE64))).toBe(true);
    expect(JSON.stringify(transcript.entries)).toContain(OBSERVATION);
  } finally {
    await t?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 90_000);
