import {
  confirmAssistantCallOp,
  createConversationOp,
  MCP_SESSION_ARG,
  OPENCODE_ASSISTANT_AGENT,
  sendAssistantMessageOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
let conversationId: string;
let sessionId: string;
let projectId: string;
const HOME = { page: 'home', params: {} } as const;
const BREAKDOWN_SESSION = { agent: 'aw-code-reviewer', title: 'Initiative · I-1' };

/** A project and a conversation that has its assistant session. */
beforeEach(async () => {
  t = await createTestApp();
  const { project } = await addProject(t, { checkCommand: null });
  projectId = project.id;
  conversationId = (await t.call(createConversationOp, {})).body.id;
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '把这份需求拆成需求计划', context: HOME });
  await t.fake.settled();
  const session = t.fake.sessions.find((item) => item.agent === OPENCODE_ASSISTANT_AGENT);
  if (session === undefined) throw new Error('Missing assistant session');
  sessionId = session.id;
});
afterEach(() => t.close());

const reports = () =>
  t.fake.prompts.filter((p) => p.sessionId === sessionId && p.text.includes('An AI breakdown you started'));

/** Calls an assistant tool as the conversation's session and confirms its card. */
async function confirmed(tool: string, args: Record<string, unknown>) {
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  const asked = await callTool(mcp, tool, { ...args, [MCP_SESSION_ARG]: sessionId });
  await mcp.close();
  expect(asked.body).toMatchObject({ status: 'needs_confirmation' });
  const res = await t.call(confirmAssistantCallOp, { id: String(asked.body.confirmation_id) });
  expect(res.body.result?.ok).toBe(true);
  return res.body.result?.ok === true ? (res.body.result.output as { id: string }) : undefined;
}

async function settled() {
  await t.fake.settled();
  await t.app.services.initiatives.settled();
  await t.fake.settled();
}

it('助手发起的拆解结束后，结果作为下一条消息回到原对话：失败时说明原因，重新拆解出草稿后列出阶段与工作包（34 §10）', async () => {
  // No turn for the breakdown session: it ends without submitting and the run fails.
  const initiative = await confirmed('initiatives_create', { projectId, requirement: '给订单模块补测试' });
  await settled();
  expect(reports()).toHaveLength(1);
  expect(reports()[0]?.text).toContain('"status": "breakdown_failed"');
  expect(reports()[0]?.text).toContain(`/initiatives/${initiative?.id}`);

  t.fake.enqueue(
    script().callTool('submit_breakdown', {
      title: '订单模块测试',
      summary: '先补核心计算，再补接口。',
      understanding: { scope: '订单模块的单元测试', assumptions: ['测试放在模块旁边'] },
      phases: [{ title: '核心计算', goal: '计算有测试' }],
      items: [
        {
          key: 'calc',
          title: '测金额计算',
          phase: 1,
          workflow: 'unit_tests',
          requirement: '为金额计算补单元测试',
          depends_on: [],
        },
      ],
      coverage: [{ point: '订单模块有测试', items: ['calc'] }],
    }),
    BREAKDOWN_SESSION,
  );
  await confirmed('initiatives_rebreakdown', { id: initiative?.id, instruction: '只补金额计算' });
  await settled();
  expect(reports()).toHaveLength(2);
  const [, draft] = reports();
  expect(draft?.text).toContain('"status": "draft_ready"');
  expect(draft?.text).toContain('"mode": "rebreakdown"');
  expect(draft?.text).toContain('核心计算');
  expect(draft?.text).toContain('测金额计算');
});
