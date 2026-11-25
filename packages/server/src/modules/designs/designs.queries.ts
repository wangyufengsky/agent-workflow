import {
  ACTIVE_ATTEMPT_STATUSES,
  AppError,
  AttemptKind,
  type AttemptSummaryDTO,
  type DesignDTO,
  DesignRunKind,
  type DesignSummaryDTO,
  designStatusOf,
  ErrorCode,
  type ListDesignsQuery,
  type ListDesignsResponse,
} from '@aw/shared';
import type { AttemptsService } from '../attempts/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { createDesignsRepo, DesignRun, ProjectDesign } from './designs.repo.ts';

type DesignRefs = Pick<DesignSummaryDTO, 'project' | 'totalSections' | 'doneSections' | 'analyzedCount'>;
type SectionCounts = Pick<DesignRefs, 'totalSections' | 'doneSections'>;
type DesignQueryDeps = {
  repo: ReturnType<typeof createDesignsRepo>;
  projects: Pick<ProjectsService, 'list' | 'getRecord'>;
  attempts: Pick<AttemptsService, 'summaries'>;
  inbox: Pick<InboxService, 'listOpen'>;
};

const runKinds: Partial<Record<AttemptKind, DesignRunKind>> = {
  [AttemptKind.DesignOutline]: DesignRunKind.Outline,
  [AttemptKind.DesignGenerate]: DesignRunKind.Generate,
  [AttemptKind.DesignRevise]: DesignRunKind.Revise,
  [AttemptKind.DesignReview]: DesignRunKind.Review,
};

function attemptOf(run: DesignRun, attempts: ReadonlyMap<string, AttemptSummaryDTO>) {
  const attempt = attempts.get(run.attemptId);
  if (attempt === undefined) throw new Error(`Design run ${run.id} has no attempt ${run.attemptId}`);
  const kind = runKinds[attempt.kind];
  if (kind === undefined) throw new Error(`Attempt ${attempt.id} does not belong to a design`);
  return { attempt, kind };
}

function summaryOf(
  design: ProjectDesign,
  refs: DesignRefs,
  latest: ReturnType<typeof attemptOf> | null,
): DesignSummaryDTO {
  const { branch, commitSha, scannedAt, analyzableCount } = design.sourceSnapshot;
  const { doneSections, totalSections } = refs;
  return {
    id: design.id,
    title: design.title,
    projectId: design.projectId,
    status: designStatusOf({
      outlineConfirmed: design.outlineConfirmedAt !== null,
      totalSections,
      doneSections,
      latestRun: latest === null ? null : { kind: latest.kind, status: latest.attempt.status },
    }),
    templateKey: design.templateKey,
    templateName: design.templateSnapshot.name,
    branch,
    commitSha,
    scannedAt,
    analyzableCount,
    updatedAt: design.updatedAt,
    ...refs,
  };
}

export function createDesignQueries({ repo, projects, attempts, inbox }: DesignQueryDeps) {
  return {
    list({ projectId, query, limit, cursor }: ListDesignsQuery): ListDesignsResponse {
      const separator = cursor?.indexOf('.') ?? -1;
      const after =
        cursor === undefined
          ? undefined
          : { updatedAt: Number(cursor.slice(0, separator)), id: cursor.slice(separator + 1) };
      const rows = repo.page({ projectId, query }, after, limit + 1);
      const page = rows.slice(0, limit);
      if (page.length === 0) return { items: [], nextCursor: null };

      const ids = page.map(({ id }) => id);
      const projectsById = new Map(projects.list().map(({ id, name }) => [id, { id, name }]));
      const sectionCounts = new Map<string, SectionCounts>(
        repo
          .sectionCounts(ids)
          .map(({ designId, totalSections, doneSections }) => [designId, { totalSections, doneSections }]),
      );
      const coverage = new Map(
        repo.analyzedCounts(ids).map(({ designId, analyzedCount }) => [designId, analyzedCount]),
      );
      const latestRuns = new Map(repo.latestRuns(ids).map((run) => [run.designId, run]));
      const summaries = attempts.summaries([...latestRuns.values()].map(({ attemptId }) => attemptId));
      const items = page.map((design) => {
        const { id, projectId } = design;
        const latest = latestRuns.get(id);
        return summaryOf(
          design,
          {
            project: projectId === null ? null : (projectsById.get(projectId) ?? null),
            ...(sectionCounts.get(id) ?? { totalSections: 0, doneSections: 0 }),
            analyzedCount: coverage.get(id) ?? 0,
          },
          latest === undefined ? null : attemptOf(latest, summaries),
        );
      });

      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last !== undefined ? `${last.updatedAt}.${last.id}` : null };
    },

    get(id: string): DesignDTO {
      const design = repo.findDesign(id);
      if (design === undefined) throw new AppError(ErrorCode.DesignNotFound, 'Project design not found', { id });
      const sections = repo
        .listSections(id)
        .map(({ designId: _designId, previous, ...section }) => ({ ...section, hasPrevious: previous !== null }));
      const files = repo.listFiles(id).map(({ designId: _designId, ...file }) => file);
      const diagrams = repo.listDiagrams(id).map(({ designId: _designId, ...diagram }) => diagram);
      const records = repo.listRuns(id);
      const summaries = attempts.summaries(records.map(({ attemptId }) => attemptId));
      const latest = records.at(-1);
      const latestDetails = latest === undefined ? null : attemptOf(latest, summaries);
      const activeRunId =
        latest !== undefined && latestDetails !== null && ACTIVE_ATTEMPT_STATUSES.includes(latestDetails.attempt.status)
          ? latest.id
          : null;
      const awaitingInput =
        activeRunId !== null && latest !== undefined && inbox.listOpen({ attemptId: latest.attemptId }).length > 0;
      const runs = records.map((record) => {
        const { designId: _designId, attemptId: _attemptId, ...run } = record;
        return { ...run, ...attemptOf(record, summaries), awaitingInput: run.id === activeRunId && awaitingInput };
      });
      const { projectId } = design;
      const project = projectId === null ? null : projects.getRecord(projectId);
      const selected = sections.filter((section) => section.selected);
      return {
        ...design,
        ...summaryOf(
          design,
          {
            project: project === null ? null : { id: project.id, name: project.name },
            totalSections: selected.length,
            doneSections: selected.filter((section) => section.blocks !== null).length,
            analyzedCount: files.filter((file) => file.responsibility !== null).length,
          },
          latestDetails,
        ),
        sections,
        files,
        diagrams,
        runs,
        activeRunId,
      };
    },
  };
}

export type DesignQueries = ReturnType<typeof createDesignQueries>;
