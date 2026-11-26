import { randomUUID } from 'node:crypto';
import {
  AppError,
  type CreateDesignRequest,
  DESIGN_TITLE_MAX_CHARS,
  DesignDepth,
  type DesignImpactLookupDTO,
  DesignKnowledgeMatch,
  DesignLayoutStyle,
  type DesignOutlineSection,
  DesignReviewState,
  ErrorCode,
  type ExportDesignRequest,
  type GenerateDesignRequest,
  type IncrementalUpdateDesignRequest,
  type LookupDesignImpactRequest,
  type ReviewDesignRequest,
  type ReviseDesignOutlineRequest,
  type ReviseDesignSectionRequest,
  ServerEventType,
  SYSTEM_THEME_MAP,
  ThemePreference,
  type UpdateDesignOutlineRequest,
  type UpdateDesignRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { replaceSectionContent } from './designs.content.ts';
import { exportDesignSite } from './designs.exporter.ts';
import { screenDesignImpact } from './designs.impact.ts';
import { restoreDesignUpdateSection } from './designs.incremental.ts';
import { readProjectKnowledge } from './designs.knowledge.ts';
import { initialDesignOutline } from './designs.outline.ts';
import type { createDesignQueries } from './designs.queries.ts';
import type { createDesignsRepo, DesignSection, ProjectDesign } from './designs.repo.ts';
import type { DesignRuns } from './designs.runs.ts';
import { scanDesignProject } from './designs.scanner.ts';
import { readDesignSource } from './designs.source.ts';
import { readDesignStaleness } from './designs.staleness.ts';
import { createDesignTemplates } from './designs.templates.ts';
import { validateDesignOutline } from './designs.validator.ts';

type Deps = {
  repo: ReturnType<typeof createDesignsRepo>;
  queries: ReturnType<typeof createDesignQueries>;
  runs: DesignRuns;
  attempts: AttemptsService;
  projects: ProjectsService;
  settings: SettingsService;
  clock: Clock;
  unit: UnitOfWork;
  assetsDir: string;
  copyFile: string;
};
function draft(section: DesignOutlineSection, designId: string, seq: number, now: number): DesignSection {
  return {
    ...section,
    id: section.id ?? randomUUID(),
    designId,
    seq,
    updatedAt: now,
    summary: '',
    blocks: null,
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    previous: null,
  };
}

export function createDesignsService({
  repo,
  queries,
  runs,
  attempts,
  projects,
  settings,
  clock,
  unit,
  assetsDir,
  copyFile,
}: Deps) {
  const exporting = new Set<string>();
  function designById(id: string) {
    const design = repo.findDesign(id);
    if (design === undefined) throw new AppError(ErrorCode.DesignNotFound, 'Design not found', { id });
    return design;
  }
  function exportProjectRoot(design: ProjectDesign): string | null {
    if (design.projectId !== null) return projects.getRecord(design.projectId).repoPath;
    // 删除项目只解除关联，设计尝试仍记录生成内容使用的项目目录。
    const run = repo.listRuns(design.id).findLast(({ isIncremental }) => !isIncremental);
    return run === undefined ? null : attempts.get(run.attemptId).directory;
  }

  function assertNotExporting(id: string) {
    if (exporting.has(id)) throw new AppError(ErrorCode.DesignBusy, 'An export is in progress', { id });
  }
  function writableDesign(id: string, { allowDuringRun = false } = {}) {
    const design = designById(id);
    assertNotExporting(id);
    if (!allowDuringRun) runs.assertIdle(id);
    if (design.projectId === null) throw new AppError(ErrorCode.StateTransitionInvalid, 'The project was deleted');
    return design;
  }
  function publish(id: string) {
    unit.publish({ type: ServerEventType.DesignUpdated, data: { designId: id } });
  }
  function change(id: string, update: (now: number) => void) {
    const now = clock.now();
    unit.transact(() => {
      update(now);
      repo.updateDesign(id, { updatedAt: now });
      publish(id);
    });
    return queries.get(id);
  }
  return {
    ...queries,
    staleness(id: string, commitSha?: string) {
      const design = designById(id);
      const repoPath = design.projectId === null ? null : projects.getRecord(design.projectId).repoPath;
      return readDesignStaleness(repo, design, repoPath, commitSha);
    },
    lookupImpact({ id, paths }: LookupDesignImpactRequest): DesignImpactLookupDTO {
      const design = designById(id);
      const knowledge = readProjectKnowledge(repo, design);
      const { candidates, uncoveredPathSet, truncated } = screenDesignImpact(
        { knowledge, match: DesignKnowledgeMatch.Reference, worktreeFresh: false },
        paths.map((path) => ({ path })),
      );
      return {
        designId: id,
        snapshotSha: knowledge.sourceSnapshot.commitSha,
        dirty: knowledge.sourceSnapshot.dirty,
        coverage: knowledge.coverage,
        candidates,
        uncoveredPaths: [...uncoveredPathSet],
        truncated,
      };
    },
    async source(id: string, fileId: string) {
      const design = designById(id);
      const file = repo.findFile(id, fileId);
      if (file === undefined || design.projectId === null) return { status: 'unavailable' } as const;
      return readDesignSource(projects.getRecord(design.projectId).repoPath, file, design.excludePatterns);
    },
    ...createDesignTemplates({ repo, projects, clock, unit }),
    async create(input: CreateDesignRequest) {
      const project = projects.getRecord(input.projectId);
      const excludePatterns = input.excludePatterns ?? [];
      const scan = await scanDesignProject(project.repoPath, excludePatterns, clock.now());
      // 扫描是异步 IO；写入外键前重新取得项目，期间删除项目应返回项目错误。
      projects.getRecord(input.projectId);
      const templateKey = input.templateKey ?? scan.recommendedTemplateKey;
      const template = repo.findTemplate(templateKey);
      if (template === undefined)
        throw new AppError(ErrorCode.DesignNotFound, 'Design template not found', { templateKey });
      const { key, name, defaultSections, focusPrompt } = template;
      const depth = input.depth ?? DesignDepth.Standard;
      const preference = settings.get('ui.theme');
      const now = clock.now();
      const id = randomUUID();
      const design: ProjectDesign = {
        id,
        projectId: project.id,
        title: `${project.name} 项目设计`.slice(0, DESIGN_TITLE_MAX_CHARS),
        depth,
        templateKey,
        templateSnapshot: { key, name, defaultSections, focusPrompt },
        theme: input.theme ?? (preference === ThemePreference.System ? SYSTEM_THEME_MAP.light : preference),
        layoutStyle: input.layoutStyle ?? DesignLayoutStyle.Arch,
        aiReviewEnabled: input.aiReviewEnabled ?? depth === DesignDepth.Deep,
        excludePatterns,
        sourceSnapshot: scan.snapshot,
        outlineConfirmedAt: null,
        lastExportedAt: null,
        lastExportedPath: null,
        createdAt: now,
        updatedAt: now,
      };
      const sections = initialDesignOutline(defaultSections, scan.files);
      unit.transact(() => {
        repo.insertDesign(design);
        repo.insertSections(sections.map((item, i) => draft(item, id, i + 1, now)));
        repo.insertFiles(
          scan.files.map((file) => ({
            ...file,
            id: randomUUID(),
            designId: id,
            sectionId: null,
            symbols: [],
            responsibility: null,
            updatedAt: now,
          })),
        );
        publish(id);
      });
      return queries.get(id);
    },
    update({ id, title, layoutStyle, theme, aiReviewEnabled }: UpdateDesignRequest) {
      const readingOnly =
        (layoutStyle !== undefined || theme !== undefined) && title === undefined && aiReviewEnabled === undefined;
      writableDesign(id, { allowDuringRun: readingOnly });
      return change(id, () =>
        repo.updateDesign(id, {
          ...(title === undefined ? {} : { title }),
          ...(layoutStyle === undefined ? {} : { layoutStyle }),
          ...(theme === undefined ? {} : { theme }),
          ...(aiReviewEnabled === undefined ? {} : { aiReviewEnabled }),
        }),
      );
    },
    updateOutline({ id, sections }: UpdateDesignOutlineRequest) {
      if (writableDesign(id).outlineConfirmedAt !== null)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'Outline is locked');
      validateDesignOutline(sections, repo.listFiles(id));
      const ids = new Set(repo.listSections(id).map((item) => item.id));
      for (const [index, item] of sections.entries()) {
        if (item.id !== undefined && !ids.delete(item.id))
          throw new AppError(ErrorCode.ValidationFailed, 'Unknown or repeated section', {
            issues: [{ path: ['sections', index, 'id'], message: 'Use a distinct section of this design' }],
          });
      }
      return change(id, (now) => {
        repo.deleteSections(id);
        repo.insertSections(sections.map((item, i) => draft(item, id, i + 1, now)));
      });
    },
    async generate({ id, ...options }: GenerateDesignRequest) {
      assertNotExporting(id);
      await runs.generate(id, options);
      return queries.get(id);
    },
    async reviseOutline({ id, ...options }: ReviseDesignOutlineRequest) {
      assertNotExporting(id);
      await runs.reviseOutline(id, options);
      return queries.get(id);
    },
    async reviseSection({ id, sectionId, ...options }: ReviseDesignSectionRequest) {
      assertNotExporting(id);
      await runs.reviseSection(id, sectionId, options);
      return queries.get(id);
    },
    async incrementalUpdate({ id, ...options }: IncrementalUpdateDesignRequest) {
      assertNotExporting(id);
      await runs.incrementalUpdate(id, options);
      return queries.get(id);
    },
    async review({ id, ...options }: ReviewDesignRequest) {
      assertNotExporting(id);
      await runs.review(id, options);
      return queries.get(id);
    },
    async stop(id: string) {
      await runs.stop(id);
      return queries.get(id);
    },
    restoreSection(id: string, sectionId: string) {
      writableDesign(id);
      const section = repo.listSections(id).find((item) => item.id === sectionId);
      if (section === undefined)
        throw new AppError(ErrorCode.DesignSectionNotFound, 'Section not found', { sectionId });
      const previous = section.previous;
      if (previous === null)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'Section has no previous version', { sectionId });
      return change(id, (now) => {
        const restored = restoreDesignUpdateSection(repo, section, previous, now);
        replaceSectionContent(repo, restored, repo.listFiles(id), previous, null, now);
      });
    },
    async export({ id, targetDir, overwrite }: ExportDesignRequest) {
      const design = designById(id);
      assertNotExporting(id);
      runs.assertIdle(id);
      const sections = repo.listSections(id);
      if (!sections.some((section) => section.selected && section.blocks !== null))
        throw new AppError(ErrorCode.StateTransitionInvalid, 'Generate a chapter before exporting');
      exporting.add(id);
      try {
        const exportedAt = clock.now();
        const result = await exportDesignSite({
          design,
          sections,
          files: repo.listFiles(id),
          diagrams: repo.listDiagrams(id),
          targetDir,
          overwrite: overwrite === true,
          projectRoot: exportProjectRoot(design),
          exportedAt,
          assetsDir,
          copyFile,
        });
        return change(id, () =>
          repo.updateDesign(id, { lastExportedAt: exportedAt, lastExportedPath: result.targetDir }),
        );
      } finally {
        exporting.delete(id);
      }
    },
    delete(id: string) {
      designById(id);
      assertNotExporting(id);
      runs.assertIdle(id);
      const ids = repo.listRuns(id).map((run) => run.attemptId);
      unit.transact(() => {
        repo.deleteDesign(id);
        attempts.delete(ids);
        publish(id);
      });
    },
    close: runs.close,
  };
}

export type DesignsService = ReturnType<typeof createDesignsService>;
