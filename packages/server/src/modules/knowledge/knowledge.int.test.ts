import { existsSync, symlinkSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  answerDraft,
  askKnowledgeOp,
  CitationProblemCode,
  deleteKnowledgeOp,
  deleteProjectOp,
  ErrorCode,
  followUpKnowledgeOp,
  getAttemptOp,
  getKnowledgeOp,
  type KnowledgeConversationDTO,
  type KnowledgeSources,
  KnowledgeTurnStatus,
  knowledgeCitationOp,
  listKnowledgeOp,
  readonlyBashRules,
  ServerEventType,
  stopKnowledgeOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

const RESEARCHER = { agent: 'aw-researcher' };
const CODE_AND_DOCS: KnowledgeSources = { code: true, docs: true, database: false, web: false };
const REFUND = [
  'export function refund(amount: number) {',
  '  const fee = amount * 0.01;',
  '  return Math.round(amount - fee);',
  '}',
  '',
].join('\n');

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function project() {
  return addProject(t, {
    files: { 'src/refund.ts': REFUND, 'docs/refunds.md': '# Refunds\n\nRounded to whole yuan.\n' },
  });
}

const ENDED = ['succeeded', 'failed', 'aborted', 'interrupted'];
/** Subscribe before the action: the next research attempt to end. */
const turnEnds = () =>
  waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (d) => d.attempt.kind === 'research' && ENDED.includes(d.attempt.status),
  );

/** Asks and waits until the turn ended and the researcher's scripted turns have played out. */
async function ask(projectId: string, question: string, sources = CODE_AND_DOCS): Promise<KnowledgeConversationDTO> {
  const ended = turnEnds();
  const res = await t.call(askKnowledgeOp, { projectId, question, sources });
  expect(res.status).toBe(201);
  await ended;
  await t.fake.settled();
  return (await t.call(getKnowledgeOp, { id: res.body.id })).body;
}

async function transcript(attemptId: string) {
  const res = await t.request({ method: 'GET', url: `/attempts/${attemptId}/transcript` });
  const page: TranscriptPage = JSON.parse(res.body);
  return page.entries;
}

/** Lines of text in the attempt's JSONL: each flush of a streaming part is one. */
async function rawTextLines(attemptId: string): Promise<number> {
  const file = join(t.dataDir, 'runs', 'knowledge', `${attemptId}.jsonl`);
  return (await readFile(file, 'utf8')).split('\n').filter((line) => line.includes('"kind":"text"')).length;
}

const answering = (answer = 'Here [1].') =>
  script().callTool('submit_answer', { answer, citations: [fileCitation('src/refund.ts', 1, 1)] });

const fileCitation = (path: string, start: number, end: number) => ({
  type: 'file',
  path,
  start_line: start,
  end_line: end,
});

describe('知识问答', () => {
  it('研究员在项目仓库中只读研究，提交的回答带校验过的引用', async () => {
    const { project: p, repo } = await project();
    t.fake.enqueue(
      script().callTool('submit_answer', {
        answer: 'The refund is rounded in `refund()` [1]; the guide says so too [2].',
        citations: [fileCitation('src/refund.ts', 2, 3), fileCitation('./docs/refunds.md', 3, 3)],
      }),
      RESEARCHER,
    );

    const conversation = await ask(p.id, 'Where is the refund rounded?\nAnd why?');

    expect(t.fake.sessions).toHaveLength(1);
    expect(t.fake.sessions[0]).toMatchObject({
      directory: repo.path,
      agent: 'aw-researcher',
      title: 'Q&A · Where is the refund rounded?',
      permission: readonlyBashRules(),
    });
    expect(t.fake.prompts[0]?.text).toContain('Where is the refund rounded?');
    expect(conversation).toMatchObject({
      title: 'Where is the refund rounded?',
      sources: CODE_AND_DOCS,
      project: { id: p.id, databaseCount: 0 },
    });
    expect(conversation.turns).toHaveLength(1);
    expect(conversation.turns[0]).toMatchObject({
      seq: 1,
      status: KnowledgeTurnStatus.Answered,
      attempt: { kind: 'research', status: 'succeeded' },
      answer: 'The refund is rounded in `refund()` [1]; the guide says so too [2].',
      citations: [
        {
          type: 'file',
          path: 'src/refund.ts',
          startLine: 2,
          endLine: 3,
          source: 'code',
          excerpt: '  const fee = amount * 0.01;\n  return Math.round(amount - fee);',
        },
        { type: 'file', path: 'docs/refunds.md', startLine: 3, endLine: 3, source: 'docs' },
      ],
    });

    const { body: list } = await t.call(listKnowledgeOp, { query: 'rounded' });
    expect(list.items).toEqual([
      expect.objectContaining({
        id: conversation.id,
        turnCount: 1,
        latest: expect.objectContaining({
          status: KnowledgeTurnStatus.Answered,
          answerExcerpt: 'The refund is rounded in refund(); the guide says so too.',
          citationCount: 2,
        }),
      }),
    ]);
    expect((await t.call(listKnowledgeOp, { query: '100%' })).body.items).toEqual([]);
  });

  it('无效引用整次被拒绝，每个问题带子码与 hint；修正后重提成功', async () => {
    const { project: p, repo } = await project();
    const outside = join(await mkdtemp(join(tmpdir(), 'aw-outside-')), 'secret.txt');
    await writeFile(outside, 'secret\n');
    symlinkSync(outside, join(repo.path, 'link.txt'));
    const valid = { answer: 'Rounded here [1].', citations: [fileCitation('src/refund.ts', 3, 3)] };
    t.fake.enqueue(
      script()
        .callTool('submit_answer', {
          answer: 'See [1] [2] [3] [4] [5] [6] [7] [9] and `arr[8]`.',
          citations: [
            fileCitation('src/missing.ts', 1, 1),
            fileCitation('src/refund.ts', 3, 9),
            fileCitation('../outside.ts', 1, 1),
            fileCitation('link.txt', 1, 1),
            fileCitation('.git/config', 1, 1),
            fileCitation('docs/refunds.md', 1, 1),
            { type: 'web', url: 'https://example.com/refunds' },
            fileCitation('src/refund.ts', 1, 1),
          ],
        })
        .callTool('submit_answer', valid),
      RESEARCHER,
    );

    const conversation = await ask(p.id, 'Where is the refund rounded?', { ...CODE_AND_DOCS, docs: false });

    const [rejected, accepted] = t.fake.toolCalls;
    expect(rejected).toMatchObject({ isError: true, result: { code: ErrorCode.KnowledgeCitationInvalid } });
    const { problems } = (rejected as { result: { details: { problems: Array<Record<string, unknown>> } } }).result
      .details;
    expect(problems.map((p) => [p.citation, p.code])).toEqual([
      [1, CitationProblemCode.FileNotFound],
      [2, CitationProblemCode.LineOutOfRange],
      [3, CitationProblemCode.OutsideProject],
      [4, CitationProblemCode.OutsideProject],
      [5, CitationProblemCode.OutsideProject],
      [6, CitationProblemCode.SourceNotSelected],
      [7, CitationProblemCode.SourceNotSelected],
      [8, CitationProblemCode.UnusedCitation],
      [9, CitationProblemCode.UnknownMarker],
    ]);
    expect(problems[1]).toMatchObject({ details: { lineCount: 4 } });
    expect(problems.every((p) => typeof p.hint === 'string' && p.hint.length > 0)).toBe(true);
    expect(accepted).toMatchObject({ isError: false, result: { accepted: true } });
    expect(conversation.turns[0]).toMatchObject({ status: KnowledgeTurnStatus.Answered, answer: valid.answer });
  });

  it('研究员只读：没有网络与写入，不能提交任务结果或向用户提问；白名单外的命令等待你允许', async () => {
    const { project: p } = await project();
    t.fake.enqueue(
      script()
        .callTool('submit_result', { summary: 'x' })
        .callTool('ask_user', { question: 'Which refund?', blocking: true })
        .requestPermission('bash', ['rm -rf src']),
      RESEARCHER,
    );
    const asked = waitForEvent(t.app.events, ServerEventType.InboxUpdated);
    const { body } = await t.call(askKnowledgeOp, { projectId: p.id, question: 'q', sources: CODE_AND_DOCS });
    await asked;

    expect((await t.call(getKnowledgeOp, { id: body.id })).body.turns[0]?.awaitingInput).toBe(true);
    expect(t.fake.toolCalls.map((c) => [c.name, (c.result as { code?: string }).code])).toEqual([
      ['submit_result', ErrorCode.McpToolNotAllowed],
      ['ask_user', ErrorCode.McpToolNotAllowed],
    ]);
    const rules = t.fake.sessions[0]?.permission ?? [];
    expect(rules.filter((r) => r.permission !== 'bash')).toEqual([]);
    expect(rules[0]).toEqual({ permission: 'bash', pattern: '*', action: 'ask' });

    // The first turn keeps waiting for the permission; the session is created before the call returns.
    t.fake.enqueue(answering(), RESEARCHER);
    await t.call(askKnowledgeOp, { projectId: p.id, question: 'q', sources: { ...CODE_AND_DOCS, web: true } });
    expect(t.fake.sessions[1]?.permission.slice(-2)).toEqual([
      { permission: 'webfetch', pattern: '*', action: 'allow' },
      { permission: 'websearch', pattern: '*', action: 'allow' },
    ]);
  });

  it('续问沿用同一 opencode 会话；研究中不能续问或删除，停止后可以继续追问', async () => {
    const { project: p } = await project();
    t.fake.enqueue(script().hang(), RESEARCHER);
    const { body: first } = await t.call(askKnowledgeOp, { projectId: p.id, question: 'one', sources: CODE_AND_DOCS });
    expect(first.turns[0]?.status).toBe(KnowledgeTurnStatus.Researching);

    const busy = await t.call(followUpKnowledgeOp, { id: first.id, question: 'two' });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: { code: ErrorCode.KnowledgeConversationBusy } });
    expect((await t.call(deleteKnowledgeOp, { id: first.id })).status).toBe(409);
    expect((await t.call(deleteProjectOp, { id: p.id })).body).toMatchObject({
      error: { code: ErrorCode.KnowledgeConversationBusy },
    });

    const stopped = await t.call(stopKnowledgeOp, { id: first.id });
    expect(stopped.body.turns[0]?.status).toBe(KnowledgeTurnStatus.Stopped);
    expect((await t.call(stopKnowledgeOp, { id: first.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
    await t.fake.settled();

    t.fake.enqueue(answering('Two [1].'), RESEARCHER);
    const ended = turnEnds();
    const res = await t.call(followUpKnowledgeOp, { id: first.id, question: 'two' });
    expect(res.status).toBe(200);
    await ended;
    await t.fake.settled();

    const { body: conversation } = await t.call(getKnowledgeOp, { id: first.id });
    expect(conversation.turns.map((turn) => [turn.seq, turn.question, turn.status])).toEqual([
      [1, 'one', KnowledgeTurnStatus.Stopped],
      [2, 'two', KnowledgeTurnStatus.Answered],
    ]);
    expect(t.fake.sessions).toHaveLength(1);
    expect(t.fake.prompts.map((prompt) => prompt.sessionId)).toEqual([t.fake.sessions[0]?.id, t.fake.sessions[0]?.id]);
    expect(t.fake.prompts[1]?.text).toContain('## Follow-up question\n\ntwo');
  });

  it('研究员停下却没提交回答：提醒一次后这一轮失败', async () => {
    const { project: p } = await project();
    t.fake.enqueue(script().text('I think it is in refund.ts.'), RESEARCHER);
    const conversation = await ask(p.id, 'q');
    expect(conversation.turns[0]).toMatchObject({
      status: KnowledgeTurnStatus.Failed,
      attempt: { nudges: 1, error: { code: ErrorCode.AttemptNoResult } },
      answer: null,
    });
    expect(t.fake.prompts.at(-1)?.text).toContain('agent-workflow_submit_answer');
  });

  it('打开引用看原文：引用区间附近的窗口，改动后标出，文件删除或编号越界为 404', async () => {
    const { project: p, repo } = await project();
    t.fake.enqueue(
      script().callTool('submit_answer', { answer: 'Here [1].', citations: [fileCitation('src/refund.ts', 2, 3)] }),
      RESEARCHER,
    );
    const turn = (await ask(p.id, 'q')).turns[0];
    if (turn === undefined) throw new Error('no turn');

    expect((await t.call(knowledgeCitationOp, { turnId: turn.id, index: 1 })).body).toEqual({
      type: 'file',
      path: 'src/refund.ts',
      startLine: 2,
      endLine: 3,
      firstLine: 1,
      lines: REFUND.split('\n').slice(0, 4),
      lineCount: 4,
      changed: false,
    });
    await writeFile(join(repo.path, 'src/refund.ts'), REFUND.replace('0.01', '0.02'));
    expect((await t.call(knowledgeCitationOp, { turnId: turn.id, index: 1 })).body).toMatchObject({ changed: true });

    const outOfRange = await t.call(knowledgeCitationOp, { turnId: turn.id, index: 2 });
    expect(outOfRange.status).toBe(404);
    expect(outOfRange.body).toMatchObject({ error: { code: ErrorCode.KnowledgeCitationNotFound } });
    await rm(join(repo.path, 'src/refund.ts'));
    const gone = await t.call(knowledgeCitationOp, { turnId: turn.id, index: 1 });
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ error: { code: ErrorCode.KnowledgeSourceUnavailable } });
  });

  it('删除对话同时删除它的研究记录；删除项目时一并删除对话', async () => {
    const { project: p } = await project();
    t.fake.enqueue(answering(), RESEARCHER);
    const first = await ask(p.id, 'one');
    t.fake.enqueue(answering(), RESEARCHER);
    const second = await ask(p.id, 'two');
    const transcript = (attemptId: string) => join(t.dataDir, 'runs', 'knowledge', `${attemptId}.jsonl`);
    const attemptOf = (c: KnowledgeConversationDTO) => c.turns[0]?.attempt.id ?? '';
    expect(existsSync(transcript(attemptOf(first)))).toBe(true);

    expect((await t.call(deleteKnowledgeOp, { id: first.id })).status).toBe(204);
    expect((await t.call(getKnowledgeOp, { id: first.id })).body).toMatchObject({
      error: { code: ErrorCode.KnowledgeConversationNotFound },
    });
    expect(existsSync(transcript(attemptOf(first)))).toBe(false);
    expect((await t.call(getAttemptOp, { id: attemptOf(first) })).status).toBe(404);

    expect((await t.call(deleteProjectOp, { id: p.id })).status).toBe(204);
    expect((await t.call(listKnowledgeOp, {})).body.items).toEqual([]);
    expect(existsSync(transcript(attemptOf(second)))).toBe(false);
  });

  it('刚回答完就删除对话：会话收尾的事件被忽略，之后的会话照常进行', async () => {
    const { project: p } = await project();
    t.fake.enqueue(answering(), RESEARCHER);
    const ended = turnEnds();
    const { body } = await t.call(askKnowledgeOp, { projectId: p.id, question: 'one', sources: CODE_AND_DOCS });
    await ended;
    // The session still winds down (the submit call returns, then the abort after it) when the rows go.
    expect((await t.call(deleteKnowledgeOp, { id: body.id })).status).toBe(204);
    await t.fake.settled();

    t.fake.enqueue(answering(), RESEARCHER);
    const next = await ask(p.id, 'two');
    expect(next.turns[0]?.status).toBe(KnowledgeTurnStatus.Answered);
    expect(t.logs.filter((l) => l.level >= 50)).toEqual([]);
  });

  it('流式回答：草稿在提交前细粒度地写进会话流；校验通过后以提交的正文为回答', async () => {
    const { project: p } = await project();
    const draft = 'The refund is rounded to cents in `refund()` before the fee is applied [1], see the guide.';
    t.fake.enqueue(
      script()
        .tool('read', { filePath: 'src/refund.ts' })
        .text(draft)
        .callTool('submit_answer', {
          answer: 'Rounded in `refund()` [1].',
          citations: [fileCitation('src/refund.ts', 3, 3)],
        }),
      RESEARCHER,
    );
    const turn = (await ask(p.id, 'Where is the refund rounded?')).turns[0];
    if (turn === undefined) throw new Error('no turn');

    const entries = await transcript(turn.attempt.id);
    const submitAt = entries.findIndex((e) => e.kind === 'tool_call' && e.data.tool === 'agent-workflow_submit_answer');
    const drafts = entries.slice(0, submitAt).filter((e) => e.kind === 'text');
    // Pages show each streaming part once; the raw lines are the flushes.
    expect(await rawTextLines(turn.attempt.id)).toBeGreaterThanOrEqual(Math.floor(draft.length / 24));
    expect(drafts.map((e) => (e.kind === 'text' ? e.data.text : ''))).toEqual([draft]);
    expect(answerDraft(entries.slice(0, submitAt))).toBe(draft);
    expect(turn).toMatchObject({ status: KnowledgeTurnStatus.Answered, answer: 'Rounded in `refund()` [1].' });
  });

  it('校验失败时这一轮仍在研究、没有回答，草稿保留；停止后草稿仍在，轮次为已停止', async () => {
    const { project: p } = await project();
    const draft = 'It is rounded in refund [1].';
    t.fake.enqueue(
      script()
        .text(draft)
        .callTool('submit_answer', { answer: draft, citations: [fileCitation('src/missing.ts', 1, 1)] })
        .hang(),
      RESEARCHER,
    );
    const rejected = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, (d) =>
      d.entries.some((e) => e.kind === 'tool_result' && e.data.tool === 'agent-workflow_submit_answer'),
    );
    const { body } = await t.call(askKnowledgeOp, { projectId: p.id, question: 'q', sources: CODE_AND_DOCS });
    await rejected;

    const researching = (await t.call(getKnowledgeOp, { id: body.id })).body.turns[0];
    expect(researching).toMatchObject({ status: KnowledgeTurnStatus.Researching, answer: null, citations: [] });
    expect(answerDraft(await transcript(researching?.attempt.id ?? ''))).toBe(draft);

    const stopped = (await t.call(stopKnowledgeOp, { id: body.id })).body.turns[0];
    expect(stopped).toMatchObject({ status: KnowledgeTurnStatus.Stopped, answer: null });
    await t.fake.settled();
    expect(answerDraft(await transcript(stopped?.attempt.id ?? ''))).toBe(draft);
  });

  it('每一轮按选的模型发起并记录：首问、换模型续问、默认模型', async () => {
    const { project: p } = await project();
    await t.call(updateSettingsOp, { 'ai.defaultModel': 'opencode/fake-model' });
    t.fake.enqueue(answering(), RESEARCHER);
    const ended = turnEnds();
    const { body } = await t.call(askKnowledgeOp, {
      projectId: p.id,
      question: 'one',
      sources: CODE_AND_DOCS,
      model: 'opencode/fake-model-2',
    });
    await ended;
    await t.fake.settled();
    for (const [question, model] of [
      ['two', 'opencode/fake-model'],
      ['three', undefined],
      ['four', null],
    ] as const) {
      t.fake.enqueue(answering(), RESEARCHER);
      const next = turnEnds();
      await t.call(followUpKnowledgeOp, { id: body.id, question, ...(model === undefined ? {} : { model }) });
      await next;
      await t.fake.settled();
    }

    const { body: conversation } = await t.call(getKnowledgeOp, { id: body.id });
    expect(conversation.turns.map((turn) => turn.model)).toEqual([
      'opencode/fake-model-2',
      'opencode/fake-model',
      'opencode/fake-model',
      null,
    ]);
    // The first message of each turn goes with its model, on the one session.
    const firsts = t.fake.prompts.filter((prompt) => !prompt.text.includes('agent-workflow_submit_answer`. Your'));
    expect(firsts.map((prompt) => prompt.model?.modelId ?? null)).toEqual([
      'fake-model-2',
      'fake-model',
      'fake-model',
      null,
    ]);
    expect(new Set(t.fake.prompts.map((prompt) => prompt.sessionId)).size).toBe(1);
    const { body: list } = await t.call(listKnowledgeOp, {});
    expect(list.items[0]?.latest.model).toBeNull();
    const invalid = await t.call(followUpKnowledgeOp, { id: body.id, question: 'five', model: 'no-slash' });
    expect(invalid.status).toBe(400);
  });

  it('项目没有关联数据库时不能把数据库选为资料来源', async () => {
    const { project: p } = await project();
    const res = await t.call(askKnowledgeOp, {
      projectId: p.id,
      question: 'q',
      sources: { code: false, docs: false, database: true, web: false },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
    expect((await t.call(listKnowledgeOp, {})).body.items).toEqual([]);
  });
});
