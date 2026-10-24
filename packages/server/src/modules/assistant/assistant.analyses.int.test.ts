import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  confirmAssistantCallOp,
  createConversationOp,
  MCP_SESSION_ARG,
  OPENCODE_ASSISTANT_AGENT,
  ServerEventType,
  sendAssistantMessageOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
let conversationId: string;
let sessionId: string;
let projectId: string;
let sha: string;
const HOME = { page: 'home', params: {} } as const;
const MEMBER = 'zs@corp.com';

/** A project with one commit of Zhang San made now, and a conversation that has its assistant session. */
beforeEach(async () => {
  t = await createTestApp();
  const { repo, project } = await addProject(t);
  await writeFile(join(repo.path, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await repo.git('add', '-A');
  await repo.git('commit', '-q', `--author=Zhang San <${MEMBER}>`, '-m', 'feat: a');
  sha = (await repo.git('rev-parse', 'HEAD')).trim();
  projectId = project.id;
  conversationId = (await t.call(createConversationOp, {})).body.id;
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '分析一下张三', context: HOME });
  await t.fake.settled();
  const session = t.fake.sessions.find((item) => item.agent === OPENCODE_ASSISTANT_AGENT);
  if (session === undefined) throw new Error('Missing assistant session');
  sessionId = session.id;
});
afterEach(() => t.close());

const reports = () =>
  t.fake.prompts.filter((p) => p.sessionId === sessionId && p.text.includes('An AI member analysis you started'));

it('助手发起的成员分析经确认后排队；分析结束后报告作为下一条消息回到原对话（33 §6）', async () => {
  t.fake.enqueue(
    script().callTool('submit_member_analysis', {
      summary: '这段时间新增了 a 模块。',
      work_items: [{ title: '新增 a 模块', description: '两个常量', commits: [sha] }],
      strengths: [{ text: '提交小而清楚', commits: [sha] }],
      concerns: [],
      findings: [],
    }),
    { agent: 'aw-code-reviewer' },
  );
  const mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  const asked = await callTool(mcp, 'team_analyses_create', {
    id: projectId,
    period: 'last_30_days',
    members: [MEMBER],
    [MCP_SESSION_ARG]: sessionId,
  });
  await mcp.close();
  expect(asked.body).toMatchObject({ status: 'needs_confirmation' });

  const ended = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (d) => d.attempt.kind === 'team_analysis' && d.attempt.endedAt !== null,
  );
  const confirmed = await t.call(confirmAssistantCallOp, { id: String(asked.body.confirmation_id) });
  expect(confirmed.body.result?.ok).toBe(true);
  await ended;
  await t.fake.settled();

  const [report] = reports();
  expect(reports()).toHaveLength(1);
  expect(report?.text).toContain('"status": "succeeded"');
  expect(report?.text).toContain('这段时间新增了 a 模块。');
  expect(report?.text).toContain('提交小而清楚');
  expect(report?.text).toContain(`/team/${projectId}/members/${encodeURIComponent(MEMBER)}?`);
});
