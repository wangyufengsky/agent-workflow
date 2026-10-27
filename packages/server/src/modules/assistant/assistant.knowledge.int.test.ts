import {
  createConversationOp,
  EntityKind,
  ErrorCode,
  getKnowledgeOp,
  KnowledgeTurnStatus,
  knowledgeLink,
  MCP_SESSION_ARG,
  OPENCODE_ASSISTANT_AGENT,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

// 18 §4a: the assistant asks the knowledge researcher; the answer comes back later as the next message.

const RESEARCHER = { agent: 'aw-researcher' };
const SOURCES = { code: true, docs: true, database: false, web: false };
const REFUND = 'export function refund(amount: number) {\n  return Math.round(amount * 100) / 100;\n}\n';

let t: TestApp;
let mcp: Client;
let conversationId: string;
let session: Record<string, string>;
let projectId: string;

beforeEach(async () => {
  t = await createTestApp();
  mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  projectId = (await addProject(t, { files: { 'src/refund.ts': REFUND } })).project.id;
  conversationId = (await t.call(createConversationOp, {})).body.id;
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversationId && !c.busy);
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '你好', context: { page: 'home', params: {} } });
  await idle;
  const created = t.fake.sessions.find((s) => s.agent === OPENCODE_ASSISTANT_AGENT);
  if (created === undefined) throw new Error('no assistant session');
  session = { [MCP_SESSION_ARG]: created.id };
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

/** The app's message reaching the assistant session: the conversation gets busy again. */
const relayed = () =>
  waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversationId && c.busy);
const lastAssistantPrompt = () => t.fake.prompts.filter((p) => p.sessionId === session[MCP_SESSION_ARG]).at(-1);

async function entityRefs(): Promise<unknown[]> {
  const res = await t.request({ method: 'GET', url: `/assistant/conversations/${conversationId}/transcript` });
  const page: TranscriptPage = JSON.parse(res.body);
  return page.entries.flatMap((e) => (e.kind === 'entity_ref' ? [e.data] : []));
}

describe('应用助手调用知识问答（18 §4a）', () => {
  it('提问不需要确认、立即返回 researching；研究完成后带引用的回答与导航卡片发回助手会话', async () => {
    t.fake.enqueue(
      script().callTool('submit_answer', {
        answer: 'Rounded in `refund()` [1].',
        citations: [{ type: 'file', path: 'src/refund.ts', start_line: 2, end_line: 2 }],
      }),
      RESEARCHER,
    );
    const delivered = relayed();
    const result = await callTool(mcp, 'knowledge_ask', {
      projectId,
      question: 'Where is the refund rounded?',
      sources: SOURCES,
      ...session,
    });

    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({ status: 'researching', instruction: expect.stringContaining('end your turn') });
    const knowledgeId = String(result.body.knowledge_conversation_id);
    await delivered;

    const { body: knowledge } = await t.call(getKnowledgeOp, { id: knowledgeId });
    const turnId = knowledge.turns[0]?.id ?? '';
    const text = lastAssistantPrompt()?.text ?? '';
    expect(text).toContain('Rounded in `refund()` [1].');
    expect(text).toContain(`[1] src/refund.ts line 2 — link: ${knowledgeLink(knowledgeId, { turnId, index: 1 })}`);
    expect(text).toContain(knowledgeLink(knowledgeId));
    expect(await entityRefs()).toEqual([
      { kind: EntityKind.KnowledgeConversation, id: knowledgeId, title: 'Where is the refund rounded?' },
    ]);
  });

  it('提问一建好就在助手对话里放导航卡片，不等研究完成', async () => {
    t.fake.enqueue(script().hang(), RESEARCHER);
    const result = await callTool(mcp, 'knowledge_ask', { projectId, question: 'q', sources: SOURCES, ...session });

    const { body: knowledge } = await t.call(getKnowledgeOp, { id: String(result.body.knowledge_conversation_id) });
    expect(knowledge.turns[0]?.status).toBe(KnowledgeTurnStatus.Researching);
    expect(await entityRefs()).toEqual([{ kind: EntityKind.KnowledgeConversation, id: knowledge.id, title: 'q' }]);
  });

  it('研究失败（停下没提交）时把错误码与原因发回助手会话', async () => {
    t.fake.enqueue(script().text('I could not find it.'), RESEARCHER);
    const delivered = relayed();
    const result = await callTool(mcp, 'knowledge_ask', { projectId, question: 'q', sources: SOURCES, ...session });
    expect(result.body).toMatchObject({ status: 'researching' });
    await delivered;

    const text = lastAssistantPrompt()?.text ?? '';
    expect(text).toContain('did not answer');
    expect(text).toContain('Outcome: failed');
    expect(text).toContain(ErrorCode.AttemptNoResult);
    expect(text).toContain(knowledgeLink(String(result.body.knowledge_conversation_id)));
  });
});
