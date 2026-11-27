import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssistantToolName,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  AttemptKind,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  createDeckOp,
  createDesignOp,
  createProjectOp,
  createTaskOp,
  DeckMaterialKind,
  DesignSectionKind,
  DesignStatus,
  ErrorCode,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  GitReviewTarget,
  generateDeckOp,
  generateDesignOp,
  getGitReviewOp,
  getProjectOp,
  getRequirementsOp,
  getSettingsOp,
  incrementalUpdateDesignOp,
  listConfirmationsOp,
  MCP_SESSION_ARG,
  McpToolName,
  OPENCODE_AGENT_NAME,
  OPENCODE_ASSISTANT_AGENT,
  OperationRisk,
  PermissionMode,
  RoleBaseAgent,
  ServerEventType,
  SlideLayout,
  sendAssistantMessageOp,
  setConversationPermissionModeOp,
  startGitReviewOp,
  type TranscriptPage,
  updateDesignOutlineOp,
  updateSettingsOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
let mcp: Client;
let conversationId: string;
/** The opencode session of the conversation, as the bridge plugin injects it. */
let session: Record<string, string>;

beforeEach(async () => {
  t = await createTestApp({ clock: createFakeClock(Date.UTC(2025, 9, 9, 20, 30, 0)), timeZone: 'Asia/Shanghai' });
  mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  conversationId = (await t.call(createConversationOp, {})).body.id;
  const idle = becomesIdle();
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '你好', context: { page: 'home', params: {} } });
  await idle;
  const [created] = t.fake.sessions;
  if (created === undefined) throw new Error('no assistant session');
  session = { [MCP_SESSION_ARG]: created.id };
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

const becomesIdle = () =>
  waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversationId && !c.busy);

const call = (name: string, args: Record<string, unknown> = {}) => callTool(mcp, name, { ...args, ...session });

async function transcript(): Promise<TranscriptPage> {
  const res = await t.request({ method: 'GET', url: `/assistant/conversations/${conversationId}/transcript` });
  return JSON.parse(res.body);
}

async function entityRefs(): Promise<unknown[]> {
  return (await transcript()).entries.flatMap((e) => (e.kind === 'entity_ref' ? [e.data] : []));
}

async function charts(): Promise<unknown[]> {
  return (await transcript()).entries.flatMap((e) => (e.kind === 'chart' ? [e.data.chart] : []));
}

/** Confirms (or cancels) and waits until the result reached the session as the next message. */
async function decide(confirmationId: string, decision: 'confirm' | 'cancel', alwaysAllow?: boolean) {
  const delivered = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.busy);
  const res =
    decision === 'confirm'
      ? await t.call(confirmAssistantCallOp, { id: confirmationId, ...(alwaysAllow ? { alwaysAllow } : {}) })
      : await t.call(cancelAssistantCallOp, { id: confirmationId });
  if (res.status === 200) await delivered;
  return res;
}

async function readyDesign(projectId: string, path: string) {
  const design = await t.call(createDesignOp, { projectId: projectId, aiReviewEnabled: false });
  expect(design.status).toBe(201);
  const outline = await t.call(updateDesignOutlineOp, {
    id: design.body.id,
    sections: [{ kind: DesignSectionKind.Module, title: '订单', scopePaths: [path] }],
  });
  expect(outline.status).toBe(200);
  const [section] = outline.body.sections;
  if (section === undefined) throw new Error('Expected a design section');
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: section.id,
      summary: '订单入口',
      blocks: [{ type: 'markdown', markdown: '订单入口' }],
      files: [{ relPath: path, responsibility: '订单入口', symbols: [] }],
      diagrams: [],
    }),
    { agent: OPENCODE_AGENT_NAME.designer },
  );
  const ready = waitForEvent(
    t.app.events,
    ServerEventType.DesignUpdated,
    ({ designId }) => designId === design.body.id && t.app.services.designs.get(designId).status === DesignStatus.Ready,
  );
  expect((await t.call(generateDesignOp, { id: design.body.id })).status).toBe(200);
  await ready;
  return { id: design.body.id, section };
}

describe('助手 MCP（/mcp/assistant，A-04）', () => {
  it.each([PermissionMode.Full, PermissionMode.Ask])(
    '%s：设计快查直接执行，Git 审查与设计增量更新逐次确认',
    async (permissionMode) => {
      const path = 'src/orders.ts';
      const { project, repo } = await addProject(t, { files: { [path]: 'export const orders = 1;' } });
      const design = await readyDesign(project.id, path);
      const from = await repo.git('rev-parse', 'HEAD');
      writeFileSync(join(repo.path, path), 'export const orders = 2;');
      await repo.git('commit', '-am', 'Change orders');
      const to = await repo.git('rev-parse', 'HEAD');
      expect(
        (
          await t.call(updateSettingsOp, {
            'ui.mode': 'pro',
            'assistant.alwaysAllow': [startGitReviewOp.id, incrementalUpdateDesignOp.id],
          })
        ).status,
      ).toBe(200);
      expect((await t.call(setConversationPermissionModeOp, { id: conversationId, permissionMode })).status).toBe(200);
      const sessionsBefore = t.fake.sessions.length;
      const staleness = await call('designs_staleness', { id: design.id });
      const impact = await call('designs_lookupImpact', { id: design.id, paths: [path] });
      expect(staleness.body).toMatchObject({ state: 'stale' });
      expect(impact.body).toMatchObject({ designId: design.id });
      expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toHaveLength(0);

      const calls = [
        await call('gitReviews_start', { id: project.id, target: { kind: GitReviewTarget.Compare, from, to } }),
        await call('gitReviews_start', { id: project.id, target: { kind: GitReviewTarget.Commit, sha: to } }),
        await call('designs_incrementalUpdate', { id: design.id, sectionIds: [design.section.id] }),
      ];
      expect(calls.map(({ body }) => body.status)).toEqual(Array(3).fill('needs_confirmation'));
      expect(t.fake.sessions).toHaveLength(sessionsBefore);
      const confirmations = await t.call(listConfirmationsOp, { id: conversationId });
      expect(confirmations.body.items.map(({ risk }) => risk)).toEqual(Array(3).fill(OperationRisk.Critical));
      const [update] = confirmations.body.items;
      if (update === undefined) throw new Error('Expected a confirmation');
      expect((await t.call(confirmAssistantCallOp, { id: update.id, alwaysAllow: true })).status).toBe(400);
    },
  );

  it('令牌与执行 MCP 分开：执行 MCP 的令牌被拒绝（401）', async () => {
    await expect(connectMcp(t.assistantMcpUrl, t.app.mcpToken)).rejects.toMatchObject({ code: 401 });
  });

  it('工具由操作清单生成并按界面模式过滤；凭据与 D65 的字段不在 schema 中，需要凭据的操作没有工具', async () => {
    const names = async () => (await mcp.listTools()).tools.map((tool) => tool.name);
    const simple = await names();
    expect(simple).toEqual(
      expect.arrayContaining(['projects_list', 'tasks_create', 'tasks_deliver', 'settings_update', 'inbox_resolve']),
    );
    expect(simple).toEqual(
      expect.arrayContaining(
        Object.values(AssistantToolName).filter((name) => name !== AssistantToolName.InvestigateDatabase),
      ),
    );
    expect(simple).not.toContain(AssistantToolName.InvestigateDatabase);
    expect(simple).not.toEqual(expect.arrayContaining(['git_status']));
    expect(simple).toContain('assistant_actBrowser');
    for (const name of simple.filter((tool) => tool !== 'assistant_actBrowser'))
      expect(name).not.toMatch(/^assistant_|^debug_/);
    expect(simple).not.toContain('databases_create');
    expect(simple).not.toContain('projects_setHosting');

    await t.call(updateSettingsOp, { 'ui.mode': 'pro' });
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['git_status', 'databases_update', AssistantToolName.InvestigateDatabase]),
    );
    const schemas = JSON.stringify(tools.map((tool) => tool.inputSchema));
    expect(schemas).not.toMatch(/"(password|token)"/);
    for (const name of ['designs_create', 'designs_update']) {
      const designTool = tools.find((tool) => tool.name === name);
      expect(designTool?.inputSchema.properties).toBeDefined();
      expect(designTool?.inputSchema.properties).not.toHaveProperty('permissionMode');
    }
    const settings = Object.keys(tools.find((tool) => tool.name === 'settings_update')?.inputSchema.properties ?? {});
    expect(settings).toContain('ui.theme');
    for (const omitted of [
      'assistant.alwaysAllow',
      'opencode.binaryPath',
      'ai.bashPolicy',
      'worktree.rootDir',
      'browser.sites',
    ]) {
      expect(settings).not.toContain(omitted);
    }
    expect(JSON.stringify(tools)).not.toContain(MCP_SESSION_ARG);
  });

  it('修改条件并重新核验的助手确认卡显示原版本、提交和新条件', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Found the issue' }), { title: '定位根因' });
    t.fake.enqueue(script().edit('fix.txt', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
      title: '· 修复',
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'OK' }), { agent: 'aw-reviewer' });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Verified' }), { title: '· 核验验收清单' });
    const review = taskReaches(t, 'review');
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: 'Add fix.txt',
      requirements: [{ title: '原条件', expected: '检查失败', verification: { kind: 'command', command: 'false' } }],
    });
    await review;
    const { body: checklist } = await t.call(getRequirementsOp, { id: task.id });
    const { revision, commitSha } = checklist;
    if (revision === null || commitSha === null) throw new Error('Expected a verified checklist');
    const input = {
      id: task.id,
      revisionId: revision.id,
      expectedCommitSha: commitSha,
      items: [{ title: '新条件', expected: '文件存在', verification: { kind: 'command', command: 'test -f fix.txt' } }],
    };
    expect(await call('tasks_reverifyRequirements', input)).toMatchObject({
      isError: false,
      body: { status: 'needs_confirmation' },
    });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toMatchObject([
      { operationId: 'tasks.reverifyRequirements', status: 'pending', input },
    ]);
    expect((await t.call(getRequirementsOp, { id: task.id })).body.revision?.id).toBe(revision.id);
  });

  it('助手将设计与对比报告一起作为 PPT 资料提交确认', async () => {
    const input = {
      brief: '发版评审',
      materials: [
        { kind: 'design', refId: 'design-id' },
        { kind: 'git_review', refId: 'comparison-id' },
      ],
    };
    expect(await call('decks_create', input)).toMatchObject({
      isError: false,
      body: { status: 'needs_confirmation' },
    });
    const cards = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(cards).toMatchObject([{ operationId: 'decks.create', status: 'pending', input }]);
  });

  it.each([PermissionMode.Full, PermissionMode.Ask])(
    '%s：含设计或审查资料的 PPT 逐次确认，普通资料仍可直接创建',
    async (permissionMode) => {
      const path = 'src/orders.ts';
      const { project, repo } = await addProject(t, { files: { [path]: 'export const orders = 1;' } });
      const design = await readyDesign(project.id, path);
      writeFileSync(join(repo.path, path), 'export const orders = 2;');
      await repo.git('commit', '-am', 'Change orders');
      const sha = await repo.git('rev-parse', 'HEAD');
      t.fake.enqueue(script().callTool(McpToolName.SubmitFindings, { summary: '发布审查', findings: [] }), {
        agent: OPENCODE_AGENT_NAME.code_reviewer,
      });
      const review = await t.call(startGitReviewOp, { id: project.id, target: { kind: GitReviewTarget.Commit, sha } });
      expect(review.status).toBe(201);
      await t.fake.settled();
      expect((await t.call(getGitReviewOp, { reviewId: review.body.id })).body.status).toBe('succeeded');

      expect((await t.call(updateSettingsOp, { 'assistant.alwaysAllow': [createDeckOp.id] })).status).toBe(200);
      expect((await t.call(setConversationPermissionModeOp, { id: conversationId, permissionMode })).status).toBe(200);
      const before = t.fake.sessions.length;
      const text = { kind: DeckMaterialKind.Text, content: '手工补充材料' };
      const request = { brief: '发布评审汇报', projectId: project.id };
      const calls = [
        await call('decks_create', {
          ...request,
          materials: [text, { kind: DeckMaterialKind.Design, refId: design.id }],
        }),
        await call('decks_create', {
          ...request,
          materials: [text, { kind: DeckMaterialKind.GitReview, refId: review.body.id }],
        }),
      ];
      expect(calls.map(({ body }) => body.status)).toEqual(['needs_confirmation', 'needs_confirmation']);
      expect(t.fake.sessions).toHaveLength(before);
      const cards = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
      expect(cards.map(({ risk }) => risk)).toEqual([OperationRisk.Critical, OperationRisk.Critical]);
      const [card] = cards;
      if (card === undefined) throw new Error('Expected a confirmation');
      expect((await t.call(confirmAssistantCallOp, { id: card.id, alwaysAllow: true })).status).toBe(400);

      const ordinary = await call('decks_create', { ...request, materials: [text] });
      expect(ordinary.isError).toBe(false);
      expect(createDeckOp.output.parse(ordinary.body)).toMatchObject({ brief: request.brief });
      expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toHaveLength(2);
    },
  );

  it('read：直接执行并返回结果', async () => {
    const { project } = await addProject(t);
    const { isError, body } = await call('projects_list');
    expect(isError).toBe(false);
    expect(body).toMatchObject({ items: [{ id: project.id, name: project.name }] });
  });

  it('「这周用了多少」：insights_summary 是 read，直接返回本周用了多少 tokens（19 §4）', async () => {
    const { isError, body } = await call('insights_summary', { period: 'week' });
    expect(isError).toBe(false);
    // The fake clock is Friday 2025-10-10 in Shanghai: the week started on Monday.
    expect(body).toMatchObject({
      period: { period: 'week', from: '2025-10-06', to: '2025-10-10', timeZone: 'Asia/Shanghai' },
      usage: { attempts: 0, tokensInput: 0, tokensOutput: 0 },
      attention: { interruptions: 0 },
    });
  });

  it('团队（33 §8.1）：team_summary 是 read，直接返回成员的数字；发起 AI 分析要用户确认', async () => {
    const repo = await createTestRepo();
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
    // The fake clock is 2025-10-10; the repository's one commit is authored now: a range of the days around today.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const range = { period: 'custom', from: day(-1), to: day(1) };
    const { isError, body } = await call('team_summary', { id: project.id, ...range });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ref: 'main', members: [{ key: 'aw-test@example.com', metrics: { commits: 1 } }] });

    const asked = await call('team_analyses_create', { id: project.id, ...range, members: ['aw-test@example.com'] });
    expect(asked.body).toMatchObject({ status: 'needs_confirmation' });
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card).toMatchObject({ operationId: 'team.analyses.create', risk: 'write', status: 'pending' });
  });

  it('write：返回 needs_confirmation；确认后操作生效，结果作为下一条消息发回同一会话', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_update', { id: project.id, name: '订单服务' });
    expect(body).toMatchObject({ status: 'needs_confirmation', confirmation_id: expect.any(String) });
    expect((await t.call(getProjectOp, { id: project.id })).body.name).toBe(project.name);
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card).toMatchObject({
      operationId: 'projects.update',
      risk: 'write',
      status: 'pending',
      input: { id: project.id, name: '订单服务' },
    });

    const res = await decide(String(body.confirmation_id), 'confirm');
    expect(res.body).toMatchObject({ status: 'confirmed', result: { ok: true, output: { name: '订单服务' } } });
    expect((await t.call(getProjectOp, { id: project.id })).body.name).toBe('订单服务');
    const last = t.fake.prompts.at(-1);
    expect(last?.sessionId).toBe(session[MCP_SESSION_ARG]);
    expect(last?.text).toContain('The user confirmed `projects_update`');
    expect(last?.text).toContain('"name": "订单服务"');
    // A second click cannot run it again.
    expect((await t.call(confirmAssistantCallOp, { id: String(body.confirmation_id) })).status).toBe(409);
  });

  it('write：在卡片上选「总是允许」后，同一操作直接执行', async () => {
    const { project } = await addProject(t);
    const first = await call('projects_update', { id: project.id, name: 'A' });
    await decide(String(first.body.confirmation_id), 'confirm', true);
    expect((await t.call(getSettingsOp, {})).body['assistant.alwaysAllow']).toEqual(['projects.update']);

    const second = await call('projects_update', { id: project.id, name: 'B' });
    expect(second.body).toMatchObject({ name: 'B' });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toHaveLength(1);
  });

  it('项目验收方式和检查命令沿用项目更新确认并保留其他设置', async () => {
    const { project } = await addProject(t);
    const configure = { id: project.id, acceptanceMode: 'command', checkCommand: 'pnpm test --run' };
    const proposed = await call('projects_update', configure);
    expect(proposed.body).toMatchObject({ status: 'needs_confirmation', confirmation_id: expect.any(String) });
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card).toMatchObject({ operationId: 'projects.update', risk: 'write', input: configure });
    expect((await t.call(getProjectOp, { id: project.id })).body).toMatchObject({
      acceptanceMode: 'auto',
      checkCommand: project.checkCommand,
    });
    const confirmed = await decide(String(proposed.body.confirmation_id), 'confirm');
    expect(confirmed.body).toMatchObject({
      result: {
        ok: true,
        output: { acceptanceMode: 'command', checkCommand: configure.checkCommand, name: project.name },
      },
    });
    const changeMode = await call('projects_update', { id: project.id, acceptanceMode: 'auto' });
    expect(changeMode.body).toMatchObject({ status: 'needs_confirmation' });
    const switched = await decide(String(changeMode.body.confirmation_id), 'confirm');
    expect(switched.body).toMatchObject({
      result: {
        ok: true,
        output: { acceptanceMode: 'auto', checkCommand: configure.checkCommand, name: project.name },
      },
    });
  });

  it('已有任务全局放行时，功能测试仍需逐次确认授权范围', async () => {
    const { project } = await addProject(t);
    await t.call(updateSettingsOp, { 'assistant.alwaysAllow': [createTaskOp.id] });
    const base = {
      projectId: project.id,
      requirement: '验证订单保存',
      requirements: [
        {
          title: '保存后可重读',
          expected: '订单状态显示为已保存',
          verification: { kind: 'command', command: 'node verify.js' },
        },
      ],
      start: false,
    };
    const functionalTest = {
      target: '/orders',
      writes: [{ method: 'POST', path: '/api/orders' }],
      caseAttachmentIds: [],
      onFailure: 'repair_and_retest',
    };
    const tool = (await mcp.listTools()).tools.find(({ name }) => name === 'tasks_create');
    expect(tool?.inputSchema.required).not.toContain('workflowId');
    expect(tool?.description).toContain('Omit workflowId');
    const { body } = await call('tasks_create', { ...base, functionalTest });
    expect(body).toMatchObject({ status: 'needs_confirmation' });
    expect(await entityRefs()).toEqual([]);
    const id = String(body.confirmation_id);
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toMatchObject([
      {
        id,
        risk: OperationRisk.Critical,
        input: {
          workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
          requirement: '验证订单保存\n\n功能验收条件\n- 保存后可重读（必验）：订单状态显示为已保存',
          functionalTest,
        },
      },
    ]);
    expect((await t.call(confirmAssistantCallOp, { id, alwaysAllow: true })).status).toBe(400);
    expect((await decide(id, 'confirm')).body.result).toMatchObject({
      ok: true,
      output: { functionalTest, requirement: expect.stringContaining('订单状态显示为已保存') },
    });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toHaveLength(1);
    const changed = await call('tasks_create', { ...base, functionalTest: { ...functionalTest, target: '/returns' } });
    expect(changed.body).toMatchObject({ status: 'needs_confirmation' });
  });

  it('功能测试确认前拒绝无效范围，确认后基线变化时回传该次参数', async () => {
    const { project, repo } = await addProject(t);
    const input = {
      projectId: project.id,
      baseBranch: 'test-baseline',
      requirement: '验证订单保存',
      functionalTest: { target: '/orders', writes: [], caseAttachmentIds: [] },
      start: false,
    };
    const invalid = await call('tasks_create', {
      ...input,
      functionalTest: { ...input.functionalTest, caseAttachmentIds: ['missing-attachment'] },
    });
    expect(invalid.body).toMatchObject({ code: ErrorCode.ValidationFailed });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toEqual([]);

    const malformedTarget = await call('tasks_create', {
      ...input,
      functionalTest: { ...input.functionalTest, target: 'http://[' },
    });
    expect(malformedTarget.body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      details: { issues: [{ path: ['functionalTest', 'target'] }] },
    });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toEqual([]);

    await runGit(['branch', 'test-baseline'], { cwd: repo.path });
    const pending = await call('tasks_create', input);
    expect(pending.body).toMatchObject({ status: 'needs_confirmation' });
    await runGit(['branch', '-D', 'test-baseline'], { cwd: repo.path });
    const result = await decide(String(pending.body.confirmation_id), 'confirm');
    expect(result.body.result).toMatchObject({ ok: false, error: { code: ErrorCode.GitBaseBranchNotFound } });
    expect(t.fake.prompts.at(-1)?.text).toContain('"retryInput"');
    expect(t.fake.prompts.at(-1)?.text).toContain('"baseBranch": "test-baseline"');
    expect(t.fake.prompts.at(-1)?.text).toContain('"target": "/orders"');
    const corrected = await call('tasks_create', { ...input, baseBranch: 'main' });
    expect(corrected.body).toMatchObject({ status: 'needs_confirmation' });
  });

  it('确认后执行「开始任务」：消息流出现指向该任务的 entity_ref（D66）', async () => {
    const { project } = await addProject(t);
    const { body } = await call('tasks_create', {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '订单时间显示错了',
      start: false,
    });
    expect(await entityRefs()).toEqual([]);
    const res = await decide(String(body.confirmation_id), 'confirm');
    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ key: 'T-1', title: '订单时间显示错了' });
    expect(await entityRefs()).toEqual([
      { kind: 'task', id: (output as { id: string }).id, title: 'T-1 · 订单时间显示错了' },
    ]);
  });

  it('「开始任务」只能转交本对话里的附件：别的附件直接报错、不出确认卡；确认后任务带上附件（30 §2.2）', async () => {
    const { project } = await addProject(t);
    const upload = async (name: string) =>
      (
        await t.request({
          method: 'POST',
          url: '/attachments',
          headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: name },
          payload: `${name}\n`,
        })
      ).json<AttachmentDTO>();
    const [own, elsewhere] = [await upload('own.md'), await upload('elsewhere.md')];
    const idle = becomesIdle();
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '需求说明在附件里',
      context: { page: 'home', params: {} },
      attachmentIds: [own.id],
    });
    await idle;
    const task = {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '按附件修',
      start: false,
    };

    const refused = await call('tasks_create', { ...task, attachmentIds: [elsewhere.id] });
    expect(refused).toMatchObject({ isError: true, body: { code: ErrorCode.AttachmentNotFound } });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toEqual([]);

    const { body } = await call('tasks_create', { ...task, attachmentIds: [own.id] });
    const res = await decide(String(body.confirmation_id), 'confirm');
    expect(res.body.result).toMatchObject({ ok: true, output: { attachments: [{ id: own.id, name: 'own.md' }] } });
  });

  it('「拆成需求计划」：只能转交本对话里的附件；确认后需求计划已创建，消息流出现指向它的 entity_ref（34 §10）', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const upload = async (name: string) =>
      (
        await t.request({
          method: 'POST',
          url: '/attachments',
          headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: name },
          payload: `${name}\n`,
        })
      ).json<AttachmentDTO>();
    const [own, elsewhere] = [await upload('需求.md'), await upload('elsewhere.md')];
    const idle = becomesIdle();
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '把这份文档拆成需求计划',
      context: { page: 'home', params: {} },
      attachmentIds: [own.id],
    });
    await idle;
    // A template with「先让我看看」: the draft waits for the user and nothing runs.
    const initiative = {
      projectId: project.id,
      templateKey: 'tests_then_refactor',
      review: true,
      requirement: '整理订单模块\n先补测试再重构。',
    };

    const refused = await call('initiatives_create', { ...initiative, attachmentIds: [elsewhere.id] });
    expect(refused).toMatchObject({ isError: true, body: { code: ErrorCode.AttachmentNotFound } });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toEqual([]);

    const { body } = await call('initiatives_create', { ...initiative, attachmentIds: [own.id] });
    expect(body).toMatchObject({ status: 'needs_confirmation' });
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card).toMatchObject({ operationId: 'initiatives.create', risk: 'write', status: 'pending' });
    const res = await decide(String(body.confirmation_id), 'confirm');
    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({
      key: 'I-1',
      title: '整理订单模块',
      status: 'draft_ready',
      attachments: [{ id: own.id, name: '需求.md' }],
    });
    expect(await entityRefs()).toEqual([
      { kind: 'initiative', id: (output as { id: string }).id, title: 'I-1 · 整理订单模块' },
    ]);

    const navigated = waitForEvent(t.app.events, ServerEventType.AssistantNavigate);
    const page = { page: 'initiative', params: { initiativeId: (output as { id: string }).id } };
    expect((await call(AssistantToolName.OpenPage, page)).body).toEqual({ opened: true });
    expect(await navigated).toEqual({ conversationId, target: page });
  });

  it('确认后执行「批量任务」：批次与子任务已创建，消息流出现指向该批次的 entity_ref（20 §8）', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const { body } = await call('batches_create', {
      projectId: project.id,
      workflowId: await workflowId(t, 'code_review'),
      requirementTemplate: '审查 {{target}}',
      targets: ['src/'],
    });
    expect(body).toMatchObject({ status: 'needs_confirmation' });
    // The batch's task runs once confirmed; it is let finish so that nothing works on while the app closes.
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Fine' }), { title: '· 代码审查' });
    const review = waitForEvent(t.app.events, ServerEventType.TaskUpdated, (task) => task.status === 'review');
    const res = await decide(String(body.confirmation_id), 'confirm');
    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ key: 'B-1', title: '审查 {{target}}', items: [{ target: 'src/' }] });
    expect(await entityRefs()).toEqual([
      { kind: 'batch', id: (output as { id: string }).id, title: 'B-1 · 审查 {{target}}' },
    ]);
    await review;
    await t.fake.settled();
  });

  it('确认后执行「定时任务」：定时任务已创建，消息流出现指向它的 entity_ref（22 §10）', async () => {
    const { project } = await addProject(t);
    const { body } = await call('schedules_create', {
      projectId: project.id,
      workflowKey: 'code_review',
      requirement: '每晚审查订单模块',
      frequency: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time: '02:00' },
    });
    expect(body).toMatchObject({ status: 'needs_confirmation' });

    const res = await decide(String(body.confirmation_id), 'confirm');

    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ title: '每晚审查订单模块', status: 'active', workflow: { key: 'code_review' } });
    expect(await entityRefs()).toEqual([
      { kind: 'schedule', id: (output as { id: string }).id, title: '每晚审查订单模块' },
    ]);
  });

  it('没有 Git 的目录（D153）：projects_create 报错并提示初始化；projects_initGit 确认后目录有第一个提交、项目已添加', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-plain-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    const refused = await call('projects_create', { repoPath: dir });
    expect(refused).toMatchObject({ isError: true, body: { code: ErrorCode.ProjectPathNoGit } });
    expect(String(refused.body.hint)).toContain('projects_initGit');

    const preview = await call('projects_previewGitInit', { repoPath: dir });
    expect(preview.body).toMatchObject({ files: 2, gitignore: expect.stringContaining('node_modules/') });
    const { body } = await call('projects_initGit', { repoPath: dir, name: '静态站' });
    expect(body).toMatchObject({ status: 'needs_confirmation' });
    expect(existsSync(join(dir, '.git'))).toBe(false);

    const res = await decide(String(body.confirmation_id), 'confirm');
    expect(res.body).toMatchObject({ result: { ok: true, output: { name: '静态站', defaultBranch: 'main' } } });
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: dir })).stdout.trim()).toBe('1');
  });

  it('直接执行（总是允许）的路径同样记下产出的对象；失败的调用不记', async () => {
    await t.call(updateSettingsOp, { 'assistant.alwaysAllow': ['projects.create'] });
    const repo = await createTestRepo();
    const { body } = await call('projects_create', { repoPath: repo.path, name: '库存服务' });
    expect(body).toMatchObject({ name: '库存服务' });
    expect(await call('projects_create', { repoPath: repo.path })).toMatchObject({ isError: true });
    expect(await entityRefs()).toEqual([{ kind: 'project', id: body.id, title: '库存服务' }]);
  });

  it('critical：不能设为总是允许，即使在总是允许列表中也每次确认', async () => {
    const { project } = await addProject(t);
    const first = await call('projects_delete', { id: project.id });
    expect(first.body).toMatchObject({ status: 'needs_confirmation' });
    const refused = await t.call(confirmAssistantCallOp, { id: String(first.body.confirmation_id), alwaysAllow: true });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });

    await t.call(updateSettingsOp, { 'assistant.alwaysAllow': ['projects.delete'] });
    const second = await call('projects_delete', { id: project.id });
    expect(second.body).toMatchObject({ status: 'needs_confirmation' });
    expect((await t.call(getProjectOp, { id: project.id })).status).toBe(200);
  });

  it('取消：操作不执行，会话收到「用户取消了该操作」', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_delete', { id: project.id });
    const res = await decide(String(body.confirmation_id), 'cancel');
    expect(res.body).toMatchObject({ status: 'cancelled', result: null });
    expect((await t.call(getProjectOp, { id: project.id })).status).toBe(200);
    expect(t.fake.prompts.at(-1)?.text).toContain('The user declined `projects_delete`');
  });

  it('会话还在回复时确认：结果在本轮结束后送达', async () => {
    const { project } = await addProject(t);
    t.fake.enqueue(
      script().callAppTool('projects_update', { id: project.id, name: 'C' }).requestPermission('bash', ['ls ..']),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );
    const asked = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.pendingPermissions.length > 0);
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改名为 C',
      context: { page: 'home', params: {} },
    });
    const [request] = (await asked).pendingPermissions;
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    if (request === undefined || card === undefined) throw new Error('missing permission or confirmation');

    const prompts = t.fake.prompts.length;
    await t.call(confirmAssistantCallOp, { id: card.id });
    expect(t.fake.prompts).toHaveLength(prompts);

    const delivered = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.busy);
    await t.app.services.assistant.replyPermission(conversationId, request.permissionId, 'reject');
    await delivered;
    await t.fake.settled();
    expect(t.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_update`');
  });

  it('opencode 不可用时确认的结果随下一条消息送达；那次发送失败时结果仍保留到下一次', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_update', { id: project.id, name: 'D' });
    t.fake.crash();
    await t.call(confirmAssistantCallOp, { id: String(body.confirmation_id) });
    t.fake.reconnect();
    const prompts = t.fake.prompts.length;

    t.fake.failNextPrompt();
    const failed = await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改好了吗？',
      context: { page: 'home', params: {} },
    });
    expect(failed.body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });

    const idle = becomesIdle();
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改好了吗？',
      context: { page: 'home', params: {} },
    });
    await idle;
    expect(t.fake.prompts).toHaveLength(prompts + 1);
    expect(t.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_update`');
    expect(t.fake.prompts.at(-1)?.text).toContain('改好了吗？');
  });

  it('不属于助手对话的会话（如执行任务的会话）调用返回 MCP_CONVERSATION_UNRESOLVED', async () => {
    t.fake.enqueue(script().hang());
    const repo = await createTestRepo();
    const attempt = await t.app.services.attempts.start({
      kind: AttemptKind.Execute,
      agent: RoleBaseAgent.Executor,
      taskId: null,
      projectId: null,
      nodeId: null,
      roleId: null,
      directory: repo.path,
      title: 'T-1 · exec',
      model: null,
      prompt: 'hello',
    });
    for (const args of [{}, { [MCP_SESSION_ARG]: attempt.opencodeSessionId }]) {
      const { isError, body } = await callTool(mcp, 'projects_list', args);
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.McpConversationUnresolved, hint: expect.any(String) });
    }
  });

  it('简单模式下调用专业模式的操作返回 MCP_TOOL_NOT_ALLOWED', async () => {
    const { project } = await addProject(t);
    const { isError, body } = await call('git_status', { id: project.id });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.McpToolNotAllowed });
  });

  it('凭据与 D65 的字段传了也被拒绝（VALIDATION_FAILED）', async () => {
    await t.call(updateSettingsOp, { 'ui.mode': 'pro' });
    for (const [name, args] of [
      ['databases_update', { id: 'c1', password: 'secret' }],
      ['settings_update', { 'assistant.alwaysAllow': ['projects.delete'] }],
      ['settings_update', { 'opencode.binaryPath': '/tmp/evil' }],
      ['settings_update', { 'ai.bashPolicy': 'auto' }],
      ['settings_update', { 'worktree.rootDir': '/tmp/elsewhere' }],
    ] as const) {
      const { isError, body } = await call(name, args);
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
    }
    expect((await t.call(getSettingsOp, {})).body).toMatchObject({
      'assistant.alwaysAllow': [],
      'opencode.binaryPath': null,
      'worktree.rootDir': null,
    });
  });
});

describe('助手专用工具（A-05）', () => {
  it('get_current_time：用户所在时区的日期、时间与星期', async () => {
    const { body } = await call(AssistantToolName.GetCurrentTime);
    expect(body).toEqual({
      now: '2025-10-10T04:30:00+08:00',
      date: '2025-10-10',
      weekday: 'Friday',
      timeZone: 'Asia/Shanghai',
      utcOffset: '+08:00',
    });
  });

  it('get_app_status：运行环境、模式与各项数量', async () => {
    await addProject(t);
    const { body } = await call(AssistantToolName.GetAppStatus);
    expect(body).toMatchObject({ uiMode: 'simple', projects: 1, activeTasks: 0, blockingInbox: 0 });
  });

  it('open_page：推送跳转事件；缺少页面需要的参数时 VALIDATION_FAILED', async () => {
    const navigated = waitForEvent(t.app.events, ServerEventType.AssistantNavigate);
    expect((await call(AssistantToolName.OpenPage, { page: 'inbox' })).body).toEqual({ opened: true });
    expect(await navigated).toEqual({ conversationId, target: { page: 'inbox', params: {} } });

    const { isError, body } = await call(AssistantToolName.OpenPage, { page: 'task' });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
  });

  it('open_form：预填非敏感字段；预填密码被拒绝', async () => {
    const opened = waitForEvent(t.app.events, ServerEventType.AssistantOpenForm);
    const values = { name: 'shop', host: '127.0.0.1', port: 3306, database: 'shop', username: 'app' };
    await call(AssistantToolName.OpenForm, { form: 'databases.create', values });
    expect(await opened).toEqual({ conversationId, form: 'databases.create', values });

    const { isError, body } = await call(AssistantToolName.OpenForm, {
      form: 'databases.create',
      values: { ...values, password: 'secret' },
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
  });

  it('open_form：按来源打开流程或组合模板，缺少来源时拒绝', async () => {
    const planOpened = waitForEvent(t.app.events, ServerEventType.AssistantOpenForm);
    await call(AssistantToolName.OpenForm, { form: 'workflows.fromPlan', values: { id: 'task-id', version: 2 } });
    expect(await planOpened).toEqual({
      conversationId,
      form: 'workflows.fromPlan',
      values: { id: 'task-id', version: 2 },
    });
    const initiativeOpened = waitForEvent(t.app.events, ServerEventType.AssistantOpenForm);
    await call(AssistantToolName.OpenForm, {
      form: 'initiativeTemplates.fromInitiative',
      values: { id: 'initiative-id' },
    });
    expect(await initiativeOpened).toEqual({
      conversationId,
      form: 'initiativeTemplates.fromInitiative',
      values: { id: 'initiative-id' },
    });
    const { isError, body } = await call(AssistantToolName.OpenForm, {
      form: 'workflows.fromPlan',
      values: { id: 'task-id' },
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
  });

  it('export_deck：做好的 PPT 由界面导出（推送请求）；没做好的 DECK_NOT_READY、不存在的 DECK_NOT_FOUND', async () => {
    const writer = { agent: 'aw-slides' };
    const deckWork = async (start: () => Promise<unknown>) => {
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        (d) => d.attempt.kind.startsWith('deck_') && d.attempt.status === 'succeeded',
      );
      await start();
      await ended;
      await t.fake.settled();
    };
    t.fake.enqueue(
      script().callTool('submit_outline', {
        title: '周报',
        understanding: { audience: '团队同事', duration: '约 5 分钟', assumptions: ['听众了解项目'] },
        slides: [{ layout: SlideLayout.Cover, title: '周报', points: ['本周进展'] }],
      }),
      writer,
    );
    let deckId = '';
    await deckWork(async () => {
      deckId = (await t.call(createDeckOp, { brief: '周报', materials: [{ kind: 'text', content: '退款改好了' }] }))
        .body.id;
    });
    expect(await call('export_deck', { deckId, format: 'pptx' })).toMatchObject({
      isError: true,
      body: { code: ErrorCode.DeckNotReady },
    });

    t.fake.enqueue(
      script().callTool('submit_slide', {
        page: 1,
        content: { layout: SlideLayout.Cover, title: '周报', subtitle: '本周' },
      }),
      writer,
    );
    await deckWork(() => t.call(generateDeckOp, { id: deckId }));
    const requested = waitForEvent(t.app.events, ServerEventType.AssistantExportDeck, () => true);
    expect((await call('export_deck', { deckId, format: 'pptx' })).body).toEqual({ exporting: true });
    expect(await requested).toEqual({ conversationId, deckId, format: 'pptx' });

    expect(await call('export_deck', { deckId: 'gone', format: 'pdf' })).toMatchObject({
      body: { code: ErrorCode.DeckNotFound },
    });
  });

  it('list_files / reveal_file：只限本对话的文件目录', async () => {
    const dir = join(t.dataDir, 'assistant', 'files', conversationId);
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'a.md'), 'a');
    writeFileSync(join(t.dataDir, 'assistant', 'outside.md'), 'x');

    expect((await call(AssistantToolName.ListFiles)).body).toEqual({
      files: [{ path: join('docs', 'a.md'), size: 1, modifiedAt: expect.any(Number) }],
    });
    const revealed = waitForEvent(t.app.events, ServerEventType.AssistantRevealFile);
    await call(AssistantToolName.RevealFile, { path: 'docs/a.md' });
    expect(await revealed).toEqual({ conversationId, absolutePath: realpathSync(join(dir, 'docs', 'a.md')) });

    for (const path of ['../../outside.md', '/etc/hosts', 'missing.md']) {
      const { isError, body } = await call(AssistantToolName.RevealFile, { path });
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
    }
  });

  it('show_chart：校验通过的图记进消息流，重启后仍在；不合规的输入 VALIDATION_FAILED 带 path、不记', async () => {
    const pie = {
      type: 'pie',
      title: '本周任务状态',
      categories: ['已完成', '待合并', '失败'],
      series: [{ name: '任务数', values: [7, 2, 1] }],
      caption: '本周开始的任务',
    };
    expect((await call(AssistantToolName.ShowChart, pie)).body).toEqual({ shown: true });

    const { isError, body } = await call(AssistantToolName.ShowChart, {
      ...pie,
      series: [{ name: '任务数', values: [7, 2] }],
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      details: { issues: [{ path: ['series', 0, 'values'], message: '2 values for 3 categories' }] },
    });
    expect(await charts()).toEqual([pie]);

    await mcp.close();
    const { dataDir, fake } = t;
    await t.close();
    t = await createTestApp({ dataDir, fake });
    mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
    expect(await charts()).toEqual([pie]);
  });

  it('show_flowchart：记为 flow 类型的图；连线指向不存在的节点时 VALIDATION_FAILED', async () => {
    const flow = {
      title: '修 Bug',
      nodes: [
        { id: 'fix', label: '修复' },
        { id: 'test', label: '测试通过吗？', shape: 'decision' },
        { id: 'done', label: '待合并', shape: 'terminal' },
      ],
      edges: [
        { from: 'fix', to: 'test' },
        { from: 'test', to: 'done', label: '通过' },
        { from: 'test', to: 'fix', label: '失败' },
      ],
    };
    expect((await call(AssistantToolName.ShowFlowchart, flow)).body).toEqual({ shown: true });
    const { body } = await call(AssistantToolName.ShowFlowchart, { ...flow, edges: [{ from: 'fix', to: 'ship' }] });
    expect(body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      details: { issues: [{ path: ['edges', 0, 'to'], message: 'no node with id "ship"' }] },
    });
    expect(await charts()).toEqual([{ type: 'flow', ...flow }]);
  });
});
