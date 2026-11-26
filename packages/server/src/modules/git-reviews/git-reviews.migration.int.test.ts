import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DesignKnowledgeMatch,
  type GitComparisonDTO,
  GitComparisonStatus,
  GitFindingStatus,
  GitReviewTarget,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { openDatabase } from '../../core/db/database.ts';
import { createGitReviewsRepo } from './git-reviews.repo.ts';

const MIGRATIONS = join(import.meta.dirname, '../../../migrations');
const DESIGN_GIT_MIGRATION = '0060_design_git_integration';
const COMPARE_GIT_MIGRATION = '0061_git_review_compare';

async function migrationsBefore(target: string, tag: string): Promise<void> {
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(
    await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  );
  const next = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(next).toBeGreaterThan(0);
  const entries = journal.entries.slice(0, next);
  await mkdir(join(target, 'meta'), { recursive: true });
  await Promise.all(entries.map(({ tag }) => copyFile(join(MIGRATIONS, `${tag}.sql`), join(target, `${tag}.sql`))));
  await writeFile(join(target, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
}

function seedLegacyReview(file: string): void {
  const raw = new DatabaseSync(file);
  const oldFinding = {
    severity: 'minor',
    category: 'tests',
    path: 'src/index.ts',
    title: '缺少测试',
    description: '需要回归测试',
  };
  try {
    raw.exec(`
      INSERT INTO projects (id, name, slug, repo_path, default_branch, created_at, updated_at)
      VALUES ('project', 'project', 'project', '/project', 'main', 1, 1);
      INSERT INTO attempts (id, kind, seq, status, directory, nudges, started_at)
      VALUES ('attempt', 'git_review', 1, 'succeeded', '/project', 0, 1);
    `);
    raw
      .prepare(`
      INSERT INTO git_reviews (id, project_id, target, label, from_sha, to_sha, attempt_id, files, summary, findings, created_at, finished_at)
      VALUES ('old', 'project', 'commit', '旧审查', 'base', 'head', 'attempt', '[]', '摘要', ?, 1, 2)
    `)
      .run(JSON.stringify([oldFinding, oldFinding]));
  } finally {
    raw.close();
  }
}

it('迁移 0059 中的审查后，为重复历史问题补齐各自稳定的 ID，并能写回单条人工状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-review-migration-'));
  try {
    const previous = join(root, 'migrations');
    const file = join(root, 'app.db');
    await migrationsBefore(previous, DESIGN_GIT_MIGRATION);
    openDatabase(file, previous).close();
    seedLegacyReview(file);

    const upgraded = openDatabase(file, MIGRATIONS);
    try {
      const repo = createGitReviewsRepo(upgraded.db);
      const historic = repo.find('old');
      expect(historic).toMatchObject({
        summary: '摘要',
        designId: null,
        designSnapshotSha: null,
        designMatch: DesignKnowledgeMatch.Missing,
        impactTruncated: false,
        impacts: [],
        regressionChecks: [],
      });
      const [first, second] = historic?.findings ?? [];
      if (first === undefined || second === undefined) throw new Error('Expected both historic findings');
      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();
      expect(first.id).not.toBe(second.id);
      expect(first.status).toBe(GitFindingStatus.Open);
      expect(second.status).toBe(GitFindingStatus.Open);
      expect(repo.list('project')[0]?.findings).toEqual([first, second]);

      repo.updateFindingStatus('old', second.id, GitFindingStatus.Accepted);
      const reopened = openDatabase(file, MIGRATIONS);
      try {
        expect(createGitReviewsRepo(reopened.db).find('old')?.findings).toEqual([
          first,
          { ...second, status: GitFindingStatus.Accepted },
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      upgraded.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('升级 0060 数据库后仍可读取历史报告，对比基线与结果可以重新打开', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-compare-migration-'));
  try {
    const previous = join(root, 'migrations');
    const file = join(root, 'app.db');
    await migrationsBefore(previous, COMPARE_GIT_MIGRATION);
    openDatabase(file, previous).close();
    seedLegacyReview(file);

    const baseline: GitComparisonDTO = {
      fromMatch: DesignKnowledgeMatch.Missing,
      toMatch: DesignKnowledgeMatch.Reference,
      toDesignId: 'reference',
      sections: [{ status: GitComparisonStatus.Modified, title: '入口', fromPath: 'src/index.ts' }],
      transactions: [],
      summary: '源码变更',
    };
    const upgraded = openDatabase(file, MIGRATIONS);
    try {
      const repo = createGitReviewsRepo(upgraded.db);
      expect(repo.find('old')?.comparison).toBeUndefined();
      repo.insert({
        id: 'compare',
        projectId: 'project',
        target: GitReviewTarget.Compare,
        label: 'base → head',
        fromSha: 'base',
        toSha: 'head',
        parent: null,
        focus: null,
        attemptId: 'attempt',
        files: [],
        comparison: baseline,
        createdAt: 2,
      });
      expect(repo.find('compare')?.comparison).toEqual(baseline);
      repo.setResult('compare', '完成', []);
      expect(repo.find('compare')?.comparison).toEqual(baseline);
      repo.setResult('compare', '完成', [], undefined, undefined, { ...baseline, summary: '已核验' });
    } finally {
      upgraded.close();
    }

    const reopened = openDatabase(file, MIGRATIONS);
    try {
      expect(createGitReviewsRepo(reopened.db).find('compare')?.comparison).toEqual({
        ...baseline,
        summary: '已核验',
      });
    } finally {
      reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
