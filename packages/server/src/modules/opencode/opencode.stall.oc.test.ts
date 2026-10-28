import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BashPolicy, OPENCODE_AGENT_NAME, RoleBaseAgent } from '@aw/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { sessionPermissionRules } from './opencode.config.ts';
import { OpencodeEventType as E, type OpencodeEvent } from './opencode.events.ts';

/**
 * Real opencode 1.19.0 when the model service stops sending in the middle of a reply (D217). A local
 * OpenAI-compatible server streams the start of a reply and then holds the rest back, as a service does that keeps a
 * long tool call until it is complete; `chunkTimeout` is shortened so opencode gives up after a moment.
 */
const PROVIDER = 'aw-stalling';
const MODEL = 'stalling';
const STALL = 'STALL';

async function lastUserText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const { messages } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    messages: Array<{ role: string; content: unknown }>;
  };
  return JSON.stringify(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
}

function stallingModel(): Server {
  return createServer((req, res) => {
    void lastUserText(req).then((text) => {
      const base = { id: 'chatcmpl-stalling', created: 0, model: MODEL, object: 'chat.completion.chunk' };
      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.setHeader('content-type', 'text/event-stream');
      send({
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Writing it now' }, finish_reason: null }],
      });
      if (text.includes(STALL)) return;
      send({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      res.end('data: [DONE]\n\n');
    });
  });
}

let model: Server;
let t: TestApp;
beforeAll(async () => {
  model = stallingModel();
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const configFile = join(await mkdtemp(join(tmpdir(), 'aw-oc-stall-')), 'opencode.json');
  await writeFile(
    configFile,
    JSON.stringify({
      provider: {
        [PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,
            apiKey: 'unused',
            chunkTimeout: 1000,
          },
          models: { [MODEL]: { name: 'Stalling', tool_call: true } },
        },
      },
    }),
  );
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: configFile } });
  await t.app.start(t.port);
});
afterAll(async () => {
  await t.close();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
});

it('@opencode 模型服务中途不再返回数据时报告 stalled；中止后会话空闲，同一会话可以继续（D217）', async () => {
  const repo = await createTestRepo();
  const opencode = t.app.services.opencode;
  const agent = OPENCODE_AGENT_NAME[RoleBaseAgent.Executor];
  const sessionId = await opencode.createSession({
    directory: repo.path,
    title: 'stall',
    agent,
    permission: sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Auto),
  });
  const seen: OpencodeEvent['type'][] = [];
  const stalled = Promise.withResolvers<void>();
  const idle = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
  const unsubscribe = opencode.subscribe((event) => {
    if (!('sessionId' in event) || event.sessionId !== sessionId) return;
    seen.push(event.type);
    if (event.type === E.Stalled) stalled.resolve();
    if (event.type === E.Idle) (seen.filter((s) => s === E.Idle).length === 1 ? idle.first : idle.second).resolve();
  });
  const prompt = (text: string) =>
    opencode.prompt({ sessionId, directory: repo.path, agent, model: { providerId: PROVIDER, modelId: MODEL }, text });
  try {
    await prompt(`${STALL}: write the whole document`);
    await stalled.promise;
    await opencode.abort({ sessionId, directory: repo.path });
    await idle.first.promise;

    await prompt('Continue in parts');
    await idle.second.promise;
    expect(seen.filter((s) => s === E.StepFinished)).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});
