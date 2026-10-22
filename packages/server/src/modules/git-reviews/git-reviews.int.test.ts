import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deleteProjectOp,
  ErrorCode,
  FindingProblemCode,
  getGitReviewOp,
  gitDraftCommitMessageOp,
  gitStageOp,
  listGitReviewsOp,
  ServerEventType,
  startGitReviewOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

const REVIEWER = { agent: 'aw-code-reviewer' };
const ENDED = ['succeeded', 'failed', 'aborted', 'interrupted'];

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

/** Subscribe before the action: the next attempt of `kind` to end. */
const attemptEnds = (kind: string) =>
  waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (d) => d.attempt.kind === kind && ENDED.includes(d.attempt.status),
  );

/** A project whose branch `feature` changed `src/refund.ts` (5 lines) on top of main. */
async function projectWithBranch() {
  const { repo, project } = await addProject(t, { files: { 'src/refund.ts': 'export const fee = 1;\n' } });
  await repo.git('checkout', '-q', '-b', 'feature');
  await writeFile(join(repo.path, 'src/refund.ts'), ['a', 'b', 'c', 'd', 'e'].map((x) => `const ${x} = 1;`).join('\n'));
  await repo.git('commit', '-q', '-am', 'Refund rules');
  await repo.git('checkout', '-q', 'main');
  return { repo, project };
}

const finding = (overrides: Record<string, unknown> = {}) => ({
  severity: 'major',
  category: 'correctness',
  path: 'src/refund.ts',
  line: 3,
  title: 'Rounding error',
  description: 'Amounts are floats.',
  suggestion: 'Use integer cents.',
  ...overrides,
});

describe('AI 审查（27 §4）', () => {
  it('审查分支：只读会话读取 diff；问题不在 diff 或行号越界时退回让 AI 修正，通过后保存结构化问题', async () => {
    const { project } = await projectWithBranch();
    t.fake.enqueue(
      script()
        .callTool('submit_findings', {
          summary: 'Two problems.',
          findings: [finding({ path: 'README.md' }), finding({ line: 9 })],
        })
        .callTool('submit_findings', { summary: 'One problem.', findings: [finding()] }),
      REVIEWER,
    );
    const ended = attemptEnds('git_review');
    const { status, body: started } = await t.call(startGitReviewOp, {
      id: project.id,
      target: { kind: 'branch', branch: 'feature' },
      focus: '金额',
    });
    expect(status).toBe(201);
    expect(started).toMatchObject({ target: 'branch', label: 'feature', files: [{ path: 'src/refund.ts' }] });
    await ended;
    await t.fake.settled();

    const [rejected, accepted] = t.fake.toolCalls;
    expect(rejected).toMatchObject({ isError: true, result: { code: ErrorCode.GitReviewFindingsInvalid } });
    const result = rejected?.result as { details: { problems: Array<{ index: number; code: string }> } } | undefined;
    const problems = result?.details.problems ?? [];
    expect(problems.map((p) => [p.index, p.code])).toEqual([
      [0, FindingProblemCode.PathNotInDiff],
      [1, FindingProblemCode.LineOutOfRange],
    ]);
    expect(accepted).toMatchObject({ isError: false });
    // The reviewer is told what to read and the user's focus; it runs read-only in the main repository.
    const prompt = t.fake.prompts.find((p) => p.text.includes('Branch feature'))?.text ?? '';
    expect(prompt).toContain(`git diff ${started.from} ${started.to}`);
    expect(prompt).toContain('金额');
    expect(t.fake.sessions.at(-1)).toMatchObject({ agent: 'aw-code-reviewer', directory: project.repoPath });

    const { body: review } = await t.call(getGitReviewOp, { reviewId: started.id });
    expect(review).toMatchObject({ status: 'succeeded', summary: 'One problem.', findings: [finding()] });
    expect(review.finishedAt).not.toBeNull();
    expect((await t.call(listGitReviewsOp, { id: project.id, to: started.to ?? '' })).body.items).toHaveLength(1);
  });

  it('同一项目同时只有一个审查；没有改动时不开始；进行中的审查挡住删除项目', async () => {
    const { repo, project } = await projectWithBranch();
    expect(
      (await t.call(startGitReviewOp, { id: project.id, target: { kind: 'worktree' } })).raw.json().error.code,
    ).toBe(ErrorCode.ValidationFailed);

    await writeFile(join(repo.path, 'notes.md'), 'new\n');
    t.fake.enqueue(script().hang(), REVIEWER);
    const { body: running } = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'worktree' } });
    expect(running).toMatchObject({ target: 'worktree', to: null, files: [{ path: 'notes.md', status: 'added' }] });
    const second = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'branch', branch: 'feature' } });
    expect([second.status, second.raw.json().error.code]).toEqual([409, ErrorCode.GitReviewRunning]);
    expect((await t.call(deleteProjectOp, { id: project.id })).raw.json().error.code).toBe(ErrorCode.GitReviewRunning);
  });
});

describe('AI 草拟提交信息（27 §7.3）', () => {
  it('按已暂存的改动草拟并直接返回；没有暂存时 GIT_NOTHING_TO_COMMIT；AI 没有提交时 COMMIT_DRAFT_FAILED', async () => {
    const { repo, project } = await addProject(t);
    expect((await t.call(gitDraftCommitMessageOp, { id: project.id })).raw.json().error.code).toBe(
      ErrorCode.GitNothingToCommit,
    );

    await writeFile(join(repo.path, 'README.md'), '# changed\n');
    await t.call(gitStageOp, { id: project.id, paths: ['README.md'] });
    t.fake.enqueue(
      script().callTool('submit_commit_message', { subject: 'docs: retitle the readme', body: 'Shorter.' }),
      REVIEWER,
    );
    const { body } = await t.call(gitDraftCommitMessageOp, { id: project.id });
    expect(body).toEqual({ subject: 'docs: retitle the readme', body: 'Shorter.' });
    expect(t.fake.prompts.at(-1)?.text).toContain('+# changed');

    t.fake.enqueue(script().text('I would call it "update".'), REVIEWER);
    const failed = await t.call(gitDraftCommitMessageOp, { id: project.id });
    expect([failed.status, failed.raw.json().error.code]).toEqual([502, ErrorCode.CommitDraftFailed]);
  });
});
