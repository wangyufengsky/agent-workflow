import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DesignDepth,
  DesignKnowledgeMatch,
  DesignLayoutStyle,
  DesignReviewState,
  DesignSectionKind,
  ThemeId,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type Database, openDatabase } from '../../core/db/database.ts';
import { projectsTable } from '../projects/index.ts';
import { createDesignsRepo, createProjectKnowledgeReader, type ProjectDesign } from './index.ts';

const migrations = fileURLToPath(new URL('../../../migrations', import.meta.url));
const projectId = 'project';
const targetSha = 'a'.repeat(40);

function design(id: string, updatedAt: number, dirty = false, commitSha: string | null = targetSha): ProjectDesign {
  return {
    id,
    projectId,
    title: id,
    depth: DesignDepth.Standard,
    templateKey: 'general',
    templateSnapshot: {
      key: 'general',
      name: '通用代码仓库',
      defaultSections: [{ kind: DesignSectionKind.Overview, title: '主章', scopeHint: 'src' }],
      focusPrompt: '分析入口',
    },
    layoutStyle: DesignLayoutStyle.Doc,
    theme: ThemeId.Default,
    excludePatterns: [],
    aiReviewEnabled: false,
    sourceSnapshot: {
      branch: 'main',
      commitSha,
      dirty,
      scannedAt: 1,
      analyzableCount: 1,
      skippedCount: 0,
      skippedReasons: {},
      techStack: [],
    },
    outlineConfirmedAt: 1,
    lastExportedPath: null,
    lastExportedAt: null,
    createdAt: 1,
    updatedAt,
  };
}

let database: Database;
beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-design-knowledge-'));
  database = openDatabase(join(directory, 'app.db'), migrations);
  database.db
    .insert(projectsTable)
    .values({
      id: projectId,
      name: projectId,
      slug: projectId,
      repoPath: directory,
      defaultBranch: 'main',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
});
afterEach(() => database.close());

it('按项目和更新时间读取最近可用设计，匹配快照提交并保留未完成章的覆盖缺口', () => {
  const repo = createDesignsRepo(database.db);
  const readKnowledge = createProjectKnowledgeReader(repo);

  function seed(record: ProjectDesign, done: boolean) {
    repo.insertDesign(record);
    repo.insertSections([
      {
        id: `${record.id}-chapter`,
        designId: record.id,
        seq: 1,
        selected: true,
        kind: DesignSectionKind.Overview,
        title: '主章',
        scopePaths: ['src'],
        summary: '',
        blocks: done ? [{ type: 'markdown', markdown: '项目总览' }] : null,
        reviewState: DesignReviewState.None,
        reviewNotes: null,
        previous: null,
        updatedAt: record.updatedAt,
      },
    ]);
  }

  seed(design('outline', 10), false);
  expect(readKnowledge(projectId, targetSha)).toEqual({ match: DesignKnowledgeMatch.Missing, knowledge: null });

  seed(design('clean', 2), true);
  const chapter = repo.listSections('clean')[0];
  if (chapter === undefined) throw new Error('Expected seeded chapter');
  repo.insertSections([
    { ...chapter, id: 'pending', seq: 2, blocks: null },
    {
      ...chapter,
      id: 'excluded',
      seq: 3,
      selected: false,
      blocks: null,
    },
  ]);
  seed({ ...design('unbound', 20), projectId: null }, true);

  expect(readKnowledge(projectId, targetSha)).toMatchObject({
    match: DesignKnowledgeMatch.Exact,
    knowledge: { designId: 'clean', coverage: { doneSections: 1, totalSections: 2 } },
  });
  expect(readKnowledge(projectId, 'b'.repeat(40)).match).toBe(DesignKnowledgeMatch.Reference);

  seed(design('dirty', 3, true), true);
  expect(readKnowledge(projectId, targetSha)).toMatchObject({
    match: DesignKnowledgeMatch.Reference,
    knowledge: { designId: 'dirty' },
  });

  seed(design('no-git', 4, false, null), true);
  expect(readKnowledge(projectId, null)).toMatchObject({
    match: DesignKnowledgeMatch.Reference,
    knowledge: { designId: 'no-git' },
  });
});
