import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AttemptKind,
  AttemptStatus,
  createDesignOp,
  DiffSide,
  deleteDesignOp,
  ErrorCode,
  exportGitReviewOp,
  GitFindingStatus,
  getGitReviewOp,
  MCP_SESSION_ARG,
  McpToolName,
  readGitReviewEvidenceOp,
  startGitReviewOp,
  updateGitFindingStatusOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createDesignsRepo } from '../designs/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const reviewer = { agent: 'aw-code-reviewer' };
const impact = {
  id: 'call-fee',
  targetKind: 'file',
  classification: 'indirect',
  evidenceClass: 'static',
  title: '退款调用',
  reason: '退款入口调用费用计算',
  evidencePath: 'src/payment.ts',
  lineStart: 2,
  lineEnd: 2,
  suggestedChecks: ['核对退款金额'],
} as const;

it('重命名证据按审查时的两端文件名定位', async () => {
  const oldPath = 'src/legacy.ts';
  const newPath = 'src/current.ts';
  const { project, repo } = await addProject(t, { files: { [oldPath]: 'export const fee = 1;\n' } });
  await repo.git('mv', oldPath, newPath);
  await repo.git('commit', '-m', 'Rename fee source');
  const sha = await repo.git('rev-parse', 'HEAD');
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitFindings, {
      summary: '核对历史文件',
      findings: [],
      impacts: [
        { ...impact, evidencePath: oldPath, side: DiffSide.Old, lineStart: 1, lineEnd: 1, sourcePaths: [oldPath] },
      ],
    }),
    reviewer,
  );
  const started = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'commit', sha } });
  expect(started.status).toBe(201);
  await t.fake.settled();
  const reviewId = started.body.id;
  const evidence = (side: DiffSide) => t.call(readGitReviewEvidenceOp, { reviewId, path: oldPath, side });
  expect((await evidence(DiffSide.Old)).body).toMatchObject({ path: oldPath, content: 'export const fee = 1;\n' });
  expect((await evidence(DiffSide.New)).body).toMatchObject({
    path: newPath,
    patch: { diff: expect.stringContaining('rename to') },
  });
});

it('按审查提交校验证据，多次无效提交后仍可提交零缺陷的业务影响并离线导出', async () => {
  const { project, repo } = await addProject(t, {
    files: {
      'src/fee.ts': 'export const fee = 2;\n',
      'src/payment.ts': 'import {fee} from "./fee";\nexport const refund = fee; // 退款\n',
      'generated.txt': 'skip',
      'secret.key': 'private',
    },
  });
  await writeFile(join(repo.path, 'src/raw.bin'), Buffer.from([0xff, 0x0a, 0xfe, 0x0a]));
  await repo.git('add', 'src/raw.bin');
  await repo.git('commit', '-m', 'Include a binary fixture');
  const sha = await repo.git('rev-parse', 'HEAD');
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, excludePatterns: ['generated.txt'] });
  const db = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  try {
    const designs = createDesignsRepo(db.db);
    const [section] = designs.listSections(design.id);
    if (!section) throw new Error('Expected design outline');
    designs.updateSection({ ...section, scopePaths: ['src'], blocks: [{ type: 'markdown', markdown: '退款设计' }] });
  } finally {
    db.close();
  }
  await writeFile(join(repo.path, 'src/payment.ts'), 'now a single line\n');
  await repo.git('commit', '-am', 'Change payment after design snapshot');
  t.fake.enqueue(script().hang(), reviewer);
  const review = (await t.call(startGitReviewOp, { id: project.id, target: { kind: 'commit', sha } })).body;
  expect(review).toMatchObject({ designId: design.id, designSnapshotSha: sha, designMatch: 'exact' });
  const attempt = t.app.services.attempts.get(review.attemptId);
  expect(attempt.kind).toBe(AttemptKind.GitReview);
  expect(t.fake.prompts.at(-1)?.text).toContain('exact');
  const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const submit = (impacts: unknown[]) =>
      callTool(mcp, McpToolName.SubmitFindings, {
        [MCP_SESSION_ARG]: attempt.opencodeSessionId,
        summary: '业务核验',
        findings: [],
        impacts,
        regression_checks: ['核对退款金额'],
      });
    for (const bad of [
      { ...impact, evidencePath: undefined },
      { ...impact, lineEnd: 3 },
      { ...impact, evidencePath: 'generated.txt' },
      { ...impact, evidencePath: 'secret.key' },
      { ...impact, evidencePath: 'src/raw.bin' },
      { ...impact, evidenceClass: 'inferred', reason: '  ' },
      { ...impact, viaImpactIds: ['absent'] },
      { ...impact, sourcePaths: ['does-not-exist.ts'] },
    ]) {
      expect(await submit([bad])).toMatchObject({ isError: true, body: { code: ErrorCode.ValidationFailed } });
    }
    expect((await t.call(getGitReviewOp, { reviewId: review.id })).body).toMatchObject({
      summary: null,
      impacts: [],
      regressionChecks: [],
    });
    expect(await submit([impact])).toMatchObject({ isError: false });
  } finally {
    await mcp.close();
  }
  const completed = (await t.call(getGitReviewOp, { reviewId: review.id })).body;
  expect(completed).toMatchObject({
    status: AttemptStatus.Succeeded,
    findings: [],
    impacts: [impact],
    regressionChecks: ['核对退款金额'],
  });
  expect(
    (await t.call(readGitReviewEvidenceOp, { reviewId: review.id, path: impact.evidencePath, side: DiffSide.New })).body
      .content,
  ).toContain('export const refund = fee; // 退款');
  expect(
    (await t.call(readGitReviewEvidenceOp, { reviewId: review.id, path: 'secret.key', side: DiffSide.New })).status,
  ).toBe(404);
  expect((await t.call(deleteDesignOp, { id: design.id })).status).toBe(204);
  expect((await t.call(getGitReviewOp, { reviewId: review.id })).body).toMatchObject({
    designId: null,
    designMatch: 'exact',
    designSnapshotSha: sha,
    impacts: [impact],
  });
  const exported = await t.call(exportGitReviewOp, { reviewId: review.id, targetDir: join(t.dataDir, 'report') });
  expect(exported.status).toBe(200);
  expect(await readFile(exported.body.path, 'utf8')).toContain('核对退款金额');
});

it('工作区证据只展示核对过的内容，重跑保留原审查的人工处置', async () => {
  const { project, repo } = await addProject(t, {
    files: { 'src/fee.ts': 'export const fee = 1;\n', 'src/payment.ts': 'first line\nsecond line\n' },
  });
  const location = { reviewId: '', path: 'src/fee.ts', side: DiffSide.New };
  await writeFile(join(repo.path, location.path), 'export const fee = 2;\n');
  const finding = {
    severity: 'major',
    category: 'correctness',
    path: location.path,
    line: 1,
    title: '精度',
    description: '金额精度不足',
    affectedImpactIds: [impact.id],
  };
  async function run() {
    t.fake.enqueue(
      script().callTool(McpToolName.SubmitFindings, { summary: '完成', findings: [finding], impacts: [impact] }),
      reviewer,
    );
    const started = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'worktree' } });
    expect(started.status).toBe(201);
    await t.fake.settled();
    return (await t.call(getGitReviewOp, { reviewId: started.body.id })).body;
  }
  const first = await run();
  expect(first.worktreeChanged).toBe(false);
  location.reviewId = first.id;
  expect(first).toMatchObject({ designMatch: 'missing', findings: [{ ...finding, status: 'open' }] });
  const saved = first.findings[0];
  if (!saved) throw new Error('Expected a finding');
  expect(
    (
      await t.call(updateGitFindingStatusOp, {
        reviewId: first.id,
        findingId: saved.id,
        status: GitFindingStatus.Accepted,
      })
    ).body.findings[0]?.status,
  ).toBe(GitFindingStatus.Accepted);
  expect((await t.call(readGitReviewEvidenceOp, location)).body).toMatchObject({
    state: 'available',
    content: 'export const fee = 2;\n',
  });
  expect((await t.call(readGitReviewEvidenceOp, { ...location, path: impact.evidencePath })).body).toMatchObject({
    state: 'available',
    content: 'first line\nsecond line\n',
    patch: null,
  });
  await writeFile(join(repo.path, location.path), 'export const fee = 3;\n');
  expect((await t.call(getGitReviewOp, { reviewId: first.id })).body.worktreeChanged).toBe(true);
  expect((await t.call(readGitReviewEvidenceOp, location)).body).toMatchObject({
    state: 'changed',
    content: null,
    patch: null,
  });
  const next = await run();
  expect(next.id).not.toBe(first.id);
  expect(next.findings[0]?.status).toBe(GitFindingStatus.Open);
  expect((await t.call(getGitReviewOp, { reviewId: first.id })).body.findings[0]?.status).toBe(
    GitFindingStatus.Accepted,
  );
});
