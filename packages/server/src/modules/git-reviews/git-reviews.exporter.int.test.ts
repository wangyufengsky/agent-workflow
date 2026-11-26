import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttemptStatus,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DiffFileStatus,
  ErrorCode,
  FindingCategory,
  FindingSeverity,
  GitComparisonStatus,
  GitFindingStatus,
  GitImpactClassification,
  GitImpactTargetKind,
  type GitReviewDTO,
  GitReviewTarget,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportGitReviewReport } from './git-reviews.exporter.ts';

const hostile = '</script><img src="https://example.test/attack">';
function review(): GitReviewDTO {
  return {
    id: 'review',
    attemptId: 'attempt',
    projectId: 'project',
    target: GitReviewTarget.Commit,
    label: hostile,
    from: 'base-sha',
    to: 'head-sha',
    parent: 1,
    focus: null,
    files: [],
    status: AttemptStatus.Succeeded,
    model: null,
    error: null,
    summary: hostile,
    findings: [
      {
        id: 'finding-1',
        severity: FindingSeverity.Major,
        category: FindingCategory.Correctness,
        path: hostile,
        line: 5,
        title: hostile,
        description: hostile,
        status: GitFindingStatus.Accepted,
        affectedImpactIds: ['impact-1'],
      },
    ],
    designId: 'design',
    designSnapshotSha: 'head-sha',
    designMatch: DesignKnowledgeMatch.Exact,
    impactTruncated: true,
    uncoveredPaths: ['src/uncovered.ts'],
    impacts: [
      {
        id: 'impact-1',
        targetKind: GitImpactTargetKind.File,
        title: '受影响文件',
        classification: GitImpactClassification.Direct,
        evidenceClass: DesignEvidenceClass.Static,
        reason: hostile,
        suggestedChecks: ['检查调用方'],
      },
    ],
    regressionChecks: ['回归入口'],
    createdAt: 1,
    finishedAt: 2,
  };
}

describe('Git 审查离线报告', () => {
  let root: string;
  let project: { name: string; repoPath: string };

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'aw-review-export-')));
    project = { name: hostile, repoPath: join(root, 'repo') };
    await mkdir(project.repoPath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('输出单个离线页面，转义模型内容和文件名，并只允许报告自身的样式及脚本', async () => {
    const target = join(root, 'report');
    const result = await exportGitReviewReport(
      { ...review(), summary: `${project.repoPath} ${hostile}` },
      project,
      target,
    );
    expect(result.path).toBe(join(target, 'index.html'));
    expect(await readdir(target)).toEqual(['index.html']);
    const html = await readFile(result.path, 'utf8');
    expect(html).toContain('&lt;/script&gt;&lt;img src=&quot;');
    expect(html).not.toContain(hostile);
    expect(html).not.toContain(project.repoPath);
    expect(html).not.toMatch(/<(?:img|link|iframe)\b|<script[^>]*\bsrc=/i);
    expect(html).toContain("default-src 'none'");
    for (const [tag, directive] of [
      ['script', 'script-src'],
      ['style', 'style-src'],
    ] as const) {
      const inline = html.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0];
      expect(inline).toBeDefined();
      expect(html).toContain(
        `${directive} 'sha256-${createHash('sha256')
          .update(inline ?? '')
          .digest('base64')}'`,
      );
    }
    expect(html).toContain('name="severity"');
    expect(html).toContain('name="status"');
    expect(html).toContain('name="classification"');
    expect(html).toContain('id="theme"');
    expect(html).toContain('href="#impact-0"');
    expect(html).toContain('id="impact-0"');
    expect(html).toContain('回归入口');
    expect(html).toContain('<dt>重要问题</dt><dd>1</dd>');
    expect(html).toContain('<dt>次要问题</dt><dd>0</dd>');
    expect(html).toContain('<dt>直接及间接影响</dt><dd>1</dd>');
    expect(html).toContain('<dt>潜在影响</dt><dd>0</dd>');
    expect(html).toContain('<time datetime="1970-01-01T00:00:00.002Z">');
  });

  it('拒绝默认覆盖未知内容，显式覆盖只替换普通报告文件', async () => {
    const target = join(root, 'report');
    await mkdir(target);
    const index = join(target, 'index.html');
    const notes = join(target, 'notes.txt');
    await writeFile(index, '旧网页');
    await writeFile(notes, '保留资料');
    await expect(exportGitReviewReport(review(), project, target)).rejects.toMatchObject({
      code: ErrorCode.DesignExportDirNotEmpty,
    });
    expect(await readFile(index, 'utf8')).toBe('旧网页');
    await expect(exportGitReviewReport(review(), project, target, true)).resolves.toEqual({ path: index });
    expect(await readFile(notes, 'utf8')).toBe('保留资料');
    expect(await readFile(index, 'utf8')).toContain('Git 审查报告');

    if (process.platform !== 'win32') {
      await rm(index);
      await symlink(notes, index);
      await expect(exportGitReviewReport(review(), project, target, true)).rejects.toMatchObject({
        code: ErrorCode.DesignExportDirNotEmpty,
      });
      expect(await readFile(notes, 'utf8')).toBe('保留资料');
    }
  });

  it('导出两端提交及快照匹配、源码文件、架构和交易差异，并转义对比内容', async () => {
    const target = join(root, 'comparison');
    const result = await exportGitReviewReport(
      {
        ...review(),
        target: GitReviewTarget.Compare,
        parent: null,
        files: [
          { path: 'src/new.ts', oldPath: 'src/old.ts', status: DiffFileStatus.Renamed, additions: 2, deletions: 1 },
        ],
        comparison: {
          fromMatch: DesignKnowledgeMatch.Reference,
          toMatch: DesignKnowledgeMatch.Exact,
          toDesignId: 'design',
          sections: [
            { status: GitComparisonStatus.Uncertain, title: hostile, fromPath: hostile, detail: project.repoPath },
          ],
          transactions: [{ status: GitComparisonStatus.Added, title: '手续费核算', toPath: 'src/new.ts' }],
          summary: '计费链路调整',
        },
      },
      project,
      target,
    );
    const html = await readFile(result.path, 'utf8');
    expect(await readdir(target)).toEqual(['index.html']);
    expect(html).toContain('直连双端点 · 非 merge-base');
    expect(html).toContain('旧版 · from <code>base-sha</code> · 参考设计');
    expect(html).toContain('新版 · to <code>head-sha</code> · 精确匹配快照');
    expect(html).toContain('src/old.ts → src/new.ts');
    expect(html).toContain('？ 待确认');
    expect(html).toContain('＋ 新增');
    expect(html).toContain('手续费核算');
    expect(html).toContain('计费链路调整');
    expect(html).toContain('<h4>&lt;/script&gt;&lt;img src=&quot;');
    expect(html).not.toContain(hostile);
    expect(html).not.toContain(project.repoPath);
    expect(html).not.toMatch(/<(?:img|link|iframe)\b|<script[^>]*\bsrc=/i);
  });

  it('串行发布同一目录的并发导出，且允许再次导出同一份报告', async () => {
    const target = join(root, 'report');
    const first = review();
    const second = { ...first, id: 'other-review' };
    const results = await Promise.allSettled([
      exportGitReviewReport(first, project, target),
      exportGitReviewReport(second, project, target),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: ErrorCode.DesignExportDirNotEmpty },
    });
    const winner = results[0]?.status === 'fulfilled' ? first : second;
    await exportGitReviewReport({ ...winner, summary: '更新后的摘要' }, project, target);
    expect(await readdir(target)).toEqual(['index.html']);
    expect(await readFile(join(target, 'index.html'), 'utf8')).toContain('更新后的摘要');
    await expect(exportGitReviewReport(first, project, join(project.repoPath, '.git'))).rejects.toMatchObject({
      code: ErrorCode.ValidationFailed,
    });
  });
});
