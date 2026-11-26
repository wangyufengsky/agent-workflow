import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuiltinDesignTemplateKey, loadBuiltinDesignTemplates } from '@aw/builtin';
import {
  AttemptKind,
  AttemptStatus,
  DesignDepth,
  DesignDiagramKind,
  DesignLayoutStyle,
  DesignReviewState,
  DesignSectionKind,
  DesignTemplateKind,
  ThemeId,
} from '@aw/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemClock } from '../../core/clock.ts';
import { loadConfig } from '../../core/config.ts';
import { type Database, openDatabase } from '../../core/db/database.ts';
import { createUnitOfWork } from '../../core/db/unit-of-work.ts';
import { createEventBus } from '../../core/event-bus.ts';
import { attemptsTable } from '../attempts/index.ts';
import { projectsTable } from '../projects/index.ts';
import { createDesignsRepo, type ProjectDesign } from './designs.repo.ts';
import { syncBuiltinDesignTemplates } from './designs.templates.ts';

const seeds = loadBuiltinDesignTemplates(loadConfig({ AW_API_TOKEN: 'x'.repeat(32), AW_DATA_DIR: '/tmp' }).promptsDir);
const migrations = fileURLToPath(new URL('../../../migrations', import.meta.url));

function design(id: string, projectId: string | null = null): ProjectDesign {
  return {
    id,
    projectId,
    title: '服务设计',
    depth: DesignDepth.Standard,
    templateKey: BuiltinDesignTemplateKey.General,
    templateSnapshot: {
      key: BuiltinDesignTemplateKey.General,
      name: '通用代码仓库',
      defaultSections: [{ kind: DesignSectionKind.Overview, title: '项目总览', scopeHint: '.' }],
      focusPrompt: '从项目入口分析',
    },
    layoutStyle: DesignLayoutStyle.Doc,
    theme: ThemeId.Default,
    excludePatterns: [],
    aiReviewEnabled: false,
    sourceSnapshot: {
      branch: null,
      commitSha: null,
      dirty: false,
      scannedAt: 1,
      analyzableCount: 1,
      skippedCount: 1,
      skippedReasons: { credentials: 1 },
      techStack: ['TypeScript'],
    },
    outlineConfirmedAt: null,
    lastExportedPath: null,
    lastExportedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('项目设计的 SQLite 持久化', () => {
  let directory: string;
  let database: Database;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'aw-design-repo-'));
    database = openDatabase(join(directory, 'app.db'), migrations);
  });
  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('从迁移创建所有表并持久化勾选状态、文件和图，按外键保留或移除数据', () => {
    const { db } = database;
    const repo = createDesignsRepo(db);
    db.insert(projectsTable)
      .values({
        id: 'project',
        name: 'project',
        slug: 'project',
        repoPath: directory,
        defaultBranch: 'main',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const attempt = 'attempt';
    db.insert(attemptsTable)
      .values({
        id: attempt,
        kind: AttemptKind.DesignGenerate,
        seq: 1,
        status: AttemptStatus.Starting,
        directory,
        nudges: 0,
        startedAt: 1,
      })
      .run();
    const original = design('design', 'project');
    const section = {
      id: 'section',
      designId: original.id,
      seq: 1,
      selected: false,
      kind: DesignSectionKind.Overview,
      title: '项目总览',
      scopePaths: ['src/index.ts'],
      summary: '',
      blocks: null,
      reviewState: DesignReviewState.None,
      reviewNotes: null,
      previous: null,
      updatedAt: 1,
    };
    const file = {
      id: 'file',
      designId: original.id,
      sectionId: section.id,
      relPath: 'src/index.ts',
      contentHash: 'a'.repeat(64),
      responsibility: null,
      symbols: [],
      updatedAt: 1,
    };
    const diagram = {
      id: 'diagram',
      designId: original.id,
      sectionId: section.id,
      kind: DesignDiagramKind.Architecture,
      title: '系统图',
      nodes: [{ id: 'main', label: '入口' }],
      edges: [],
      updatedAt: 1,
    };
    const run = {
      id: 'run',
      designId: original.id,
      seq: 1,
      attemptId: attempt,
      targetSectionIds: [section.id],
      doneSectionIds: [],
      instruction: null,
      createdAt: 1,
    };
    db.transaction(() => {
      repo.insertDesign(original);
      repo.insertSections([section]);
      repo.insertFiles([file]);
      repo.insertDiagrams([diagram]);
      repo.insertRun(run);
    });
    expect(repo.findDesign(original.id)).toEqual(original);
    expect(repo.listSections(original.id)).toEqual([section]);
    expect(repo.listFiles(original.id)).toEqual([file]);
    const analyzed = { ...file, responsibility: '加载服务入口', updatedAt: 2 };
    repo.updateFile(analyzed);
    expect(repo.listFiles(original.id)).toEqual([analyzed]);
    expect(repo.listDiagrams(original.id)).toEqual([diagram]);
    expect(repo.findRunByAttempt(attempt)).toEqual(run);
    expect(() => repo.insertFiles([{ ...file, id: 'duplicate' }])).toThrow(/UNIQUE constraint/);

    db.delete(projectsTable).where(eq(projectsTable.id, 'project')).run();
    expect(repo.findDesign(original.id)?.projectId).toBeNull();
    repo.deleteSections(original.id);
    expect(repo.listFiles(original.id)).toEqual([{ ...analyzed, sectionId: null }]);
    expect(repo.listDiagrams(original.id)).toEqual([]);

    db.transaction(() => {
      repo.deleteDesign(original.id);
      db.delete(attemptsTable).where(eq(attemptsTable.id, attempt)).run();
    });
    expect(repo.findDesign(original.id)).toBeUndefined();
    expect(repo.listRuns(original.id)).toEqual([]);
    expect(repo.listFiles(original.id)).toEqual([]);
  });

  it('一次保存超过单条 SQL 参数上限的扫描清单', () => {
    const { db } = database;
    const repo = createDesignsRepo(db);
    const original = design('large-design');
    const files = Array.from({ length: 4200 }, (_, index) => ({
      id: `file-${index}`,
      designId: original.id,
      sectionId: null,
      relPath: `src/file-${index}.ts`,
      contentHash: 'a'.repeat(64),
      responsibility: null,
      symbols: [],
      updatedAt: 1,
    }));
    db.transaction(() => {
      repo.insertDesign(original);
      repo.insertFiles(files);
    });
    const persisted = repo.listFiles(original.id);
    expect(persisted).toHaveLength(files.length);
    expect(persisted.find(({ id }) => id === 'file-4199')).toEqual(files.at(-1));
  });

  it('升级内置架构和交易模板时保留自定义模板和所有旧设计快照', () => {
    const { db } = database;
    const repo = createDesignsRepo(db);
    const unit = createUnitOfWork(db, createEventBus());
    const legacyTemplates = [
      [BuiltinDesignTemplateKey.General, '通用代码仓库'],
      ['java_backend', 'Java / Spring 后端'],
      ['react_frontend', 'React / Web 前端'],
      ['fullstack', '全栈应用'],
      ['ai_agent', 'AI Agent / 工具链'],
    ] as const;
    const reports = legacyTemplates.map(([key, name]) => {
      const original = design(`saved-${key}`);
      const snapshot = { ...original.templateSnapshot, key, name, focusPrompt: `${name}的原始侧重` };
      repo.upsertTemplate({
        ...snapshot,
        kind: DesignTemplateKind.Builtin,
        description: name,
        matchHints: [],
        updatedAt: 1,
      });
      const report = { ...original, templateKey: key, templateSnapshot: snapshot };
      repo.insertDesign(report);
      return report;
    });
    repo.upsertTemplate({
      ...design('custom-sample').templateSnapshot,
      key: 'custom-test',
      kind: DesignTemplateKind.Custom,
      description: '自定义分析',
      matchHints: [],
      updatedAt: 1,
    });
    syncBuiltinDesignTemplates(repo, unit, systemClock, seeds);
    expect(repo.listTemplates().map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: BuiltinDesignTemplateKey.General, kind: DesignTemplateKind.Builtin },
      { key: BuiltinDesignTemplateKey.TransactionExplorer, kind: DesignTemplateKind.Builtin },
      { key: 'custom-test', kind: DesignTemplateKind.Custom },
    ]);
    expect(repo.findTemplate(BuiltinDesignTemplateKey.General)?.name).toBe('架构探索');
    expect(repo.findTemplate('custom-test')?.description).toBe('自定义分析');
    for (const original of reports) expect(repo.findDesign(original.id)).toEqual(original);
  });
});
