import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  DiffSide,
  ErrorCode,
  type GitComparisonDTO,
  type GitReviewTargetInput,
  getGitReviewOp,
  MCP_SESSION_ARG,
  McpToolName,
  readGitReviewEvidenceOp,
  startGitReviewOp,
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
const source = 'src/rate.ts';
const conclusion = '核对两端费率及其业务影响';

async function fork() {
  const { project, repo } = await addProject(t, { files: { [source]: 'rate = 0\n' } });
  const base = await repo.git('rev-parse', 'HEAD');
  for (const [branch, rate] of [
    ['old-tip', '10'],
    ['new-tip', '20'],
  ] as const) {
    await repo.git('checkout', '-b', branch, base);
    await writeFile(join(repo.path, source), `rate = ${rate}\n`);
    await writeFile(join(repo.path, 'policy.ts'), `policy = ${rate}\n`);
    await writeFile(join(repo.path, `${branch}.txt`), `${branch}\n`);
    await repo.git('add', '-A');
    await repo.git('commit', '-m', branch);
  }
  const from = await repo.git('rev-parse', 'old-tip');
  const to = await repo.git('rev-parse', 'new-tip');
  return { project, repo, from, to, base };
}

async function complete(id: string, target: GitReviewTargetInput) {
  t.fake.enqueue(script().callTool(McpToolName.SubmitFindings, { summary: conclusion, findings: [] }), reviewer);
  const result = await t.call(startGitReviewOp, { id, target });
  expect(result.status).toBe(201);
  await t.fake.settled();
  const { body } = await t.call(getGitReviewOp, { reviewId: result.body.id });
  expect(body.status).toBe('succeeded');
  return body;
}

async function designAtHead(projectId: string, excludePatterns: string[] = []) {
  const result = await t.call(createDesignOp, { projectId, excludePatterns });
  const db = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  try {
    const designs = createDesignsRepo(db.db);
    const [section] = designs.listSections(result.body.id);
    if (!section) throw new Error('Expected a design outline');
    designs.updateSection({
      ...section,
      title: '费率规则',
      scopePaths: [source],
      blocks: [{ type: 'markdown', markdown: '费率计算' }],
    });
    return { id: result.body.id, section: section.id };
  } finally {
    db.close();
  }
}

it('分叉分支区间取共同祖先；双端点比较使用原端点，分支移动后仍读原版正文', async () => {
  const { project, repo, from, to, base } = await fork();
  const refs = { from: 'old-tip', to: 'new-tip' };
  const range = await complete(project.id, { kind: 'range', ...refs });
  expect(range.from).toBe(base);
  expect(range.files.map((f) => f.path)).not.toContain('old-tip.txt');
  expect(range.comparison).toBeUndefined();

  const review = await complete(project.id, { kind: 'compare', ...refs });
  expect(review).toMatchObject({
    from,
    to,
    label: `${from.slice(0, 7)} → ${to.slice(0, 7)}`,
    comparison: { fromMatch: 'missing', toMatch: 'missing', summary: conclusion },
  });
  expect(review.files).toContainEqual(expect.objectContaining({ path: 'old-tip.txt', status: 'deleted' }));
  expect(t.fake.prompts.at(-1)?.text).toContain(`git diff -M ${from} ${to}`);
  await writeFile(join(repo.path, source), 'rate = 99\n');
  await repo.git('commit', '-am', 'Move current endpoint');
  await repo.git('branch', '-f', 'old-tip', 'HEAD');
  const evidence = (path: string, side: DiffSide) =>
    t.call(readGitReviewEvidenceOp, { reviewId: review.id, path, side });
  expect((await evidence(source, DiffSide.Old)).body).toMatchObject({ content: 'rate = 10\n' });
  expect((await evidence(source, DiffSide.New)).body).toMatchObject({ content: 'rate = 20\n' });
  expect((await evidence('old-tip.txt', DiffSide.New)).body.state).toBe('unavailable');
  expect((await evidence('README.md', DiffSide.New)).status).toBe(404);
});

it('冻结两端设计与条目，拒绝伪造引用并允许模型在原会话纠正', async () => {
  const { project, repo, from, to } = await fork();
  const target = { kind: 'compare', from, to } as const;
  await repo.git('checkout', 'old-tip');
  const old = await designAtHead(project.id, ['policy.ts']);
  const partial = await complete(project.id, target);
  expect(partial.comparison).toMatchObject({
    fromMatch: 'exact',
    fromDesignId: old.id,
    toMatch: 'reference',
    sections: [],
    transactions: [],
  });

  await repo.git('checkout', 'new-tip');
  const next = await designAtHead(project.id);
  t.fake.enqueue(script().hang(), reviewer);
  const { body: review } = await t.call(startGitReviewOp, { id: project.id, target });
  const baseline = review.comparison;
  expect(baseline).toMatchObject({
    fromDesignId: old.id,
    toDesignId: next.id,
    fromMatch: 'exact',
    toMatch: 'exact',
    sections: [{ fromId: old.section, toId: next.section, status: 'modified' }],
  });
  if (!baseline) throw new Error('Expected a frozen comparison');
  const policy = (side: DiffSide) => t.call(readGitReviewEvidenceOp, { reviewId: review.id, path: 'policy.ts', side });
  expect((await policy(DiffSide.Old)).body).toMatchObject({ state: 'unavailable', content: null, patch: null });
  expect((await policy(DiffSide.New)).body).toMatchObject({
    state: 'available',
    content: 'policy = 20\n',
    patch: null,
  });
  const [row] = baseline.sections;
  if (!row) throw new Error('Expected the rate section');
  const attempt = t.app.services.attempts.get(review.attemptId);
  const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const submit = (comparison: unknown) =>
      callTool(mcp, McpToolName.SubmitFindings, {
        [MCP_SESSION_ARG]: attempt.opencodeSessionId,
        summary: conclusion,
        findings: [],
        comparison,
      });
    const valid: GitComparisonDTO = { ...baseline, summary: '新版本将费率从 10 调整为 20。' };
    for (const invalid of [
      { ...valid, sections: 'invalid' },
      { ...valid, toDesignId: old.id },
      { ...valid, fromMatch: 'reference' },
      { ...valid, sections: [{ ...row, fromId: next.section }] },
      { ...valid, sections: [{ title: '外部', status: 'added', toPath: '../private.ts' }] },
      { ...valid, sections: [{ title: '无关', status: 'added', toPath: 'README.md' }] },
      { ...valid, sections: [{ title: '旧端排除', status: 'removed', fromPath: 'policy.ts' }] },
      { ...valid, sections: [{ title: '选错版本', status: 'added', toPath: 'old-tip.txt' }] },
    ]) {
      expect(await submit(invalid)).toMatchObject({ isError: true, body: { code: ErrorCode.ValidationFailed } });
    }
    expect((await t.call(getGitReviewOp, { reviewId: review.id })).body).toMatchObject({
      summary: null,
      comparison: baseline,
    });
    expect(await submit(valid)).toMatchObject({ isError: false });
    expect((await t.call(getGitReviewOp, { reviewId: review.id })).body).toMatchObject({
      status: 'succeeded',
      comparison: valid,
    });
  } finally {
    await mcp.close();
  }
});

it('允许相同文件树的端点报告；普通审查拒绝 comparison 后仍可按旧契约完成', async () => {
  const { project, repo, from, to } = await fork();
  await repo.git('commit', '--allow-empty', '-m', 'Release marker');
  const marker = await repo.git('rev-parse', 'HEAD');
  const sameTree = await complete(project.id, { kind: 'compare', from: to, to: marker });
  expect(sameTree).toMatchObject({ from: to, to: marker, files: [], comparison: { summary: conclusion } });
  t.fake.enqueue(
    script()
      .callTool(McpToolName.SubmitFindings, { summary: conclusion, findings: [], comparison: sameTree.comparison })
      .callTool(McpToolName.SubmitFindings, { summary: conclusion, findings: [] }),
    reviewer,
  );
  const { body } = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'range', from, to } });
  await t.fake.settled();
  expect(t.fake.toolCalls.at(-2)).toMatchObject({ isError: true, result: { code: ErrorCode.ValidationFailed } });
  expect((await t.call(getGitReviewOp, { reviewId: body.id })).body.comparison).toBeUndefined();
});
