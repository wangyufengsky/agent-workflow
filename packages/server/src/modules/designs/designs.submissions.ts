import { randomUUID } from 'node:crypto';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  DesignReviewState,
  ErrorCode,
  ServerEventType,
  type SubmitDesignOutlineInput,
  type SubmitDesignReviewInput,
  type SubmitDesignSectionInput,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import { replaceSectionContent, snapshotSection } from './designs.content.ts';
import type { createDesignsRepo, DesignSection } from './designs.repo.ts';
import { validateDesignOutline, validateDesignReview, validateDesignSection } from './designs.validator.ts';

type Dependencies = {
  repo: ReturnType<typeof createDesignsRepo>;
  attempts: Pick<AttemptsService, 'get' | 'markSubmitted' | 'projectOf'>;
  projects: Pick<ProjectsService, 'getRecord'>;
  unit: UnitOfWork;
  clock: Clock;
};

function invalid(path: (string | number)[], message: string): never {
  throw new AppError(ErrorCode.ValidationFailed, 'Invalid project design submission', { issues: [{ path, message }] });
}

export function createDesignSubmissions({ repo, attempts, projects, unit, clock }: Dependencies) {
  function activeRun(attempt: AttemptDTO) {
    if (attempts.get(attempt.id).status !== AttemptStatus.Running)
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'This project design attempt has ended');
    const run = repo.findRunByAttempt(attempt.id);
    if (run === undefined) throw new AppError(ErrorCode.McpAttemptUnresolved, 'No design run belongs to this attempt');
    const design = repo.findDesign(run.designId);
    if (design === undefined) throw new AppError(ErrorCode.DesignNotFound);
    if (design.projectId === null || design.projectId !== attempts.projectOf(attempt.id))
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This design no longer belongs to the project of this attempt');
    if (repo.listRuns(design.id).at(-1)?.attemptId !== attempt.id)
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'A newer project design run is registered');
    return { run, design, projectId: design.projectId };
  }

  function publish(designId: string, now: number): void {
    repo.updateDesign(designId, { updatedAt: now });
    unit.publish({ type: ServerEventType.DesignUpdated, data: { designId } });
  }

  function mustFindSection(designId: string, sectionId: string): DesignSection {
    const section = repo.listSections(designId).find(({ id }) => id === sectionId);
    if (section === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
    return section;
  }

  function context(attempt: AttemptDTO, sectionId?: string) {
    const { design, run, projectId } = activeRun(attempt);
    const files = repo.listFiles(design.id);
    const scope =
      sectionId !== undefined && run.targetSectionIds.includes(sectionId)
        ? mustFindSection(design.id, sectionId).scopePaths
        : [];
    return {
      root: projects.getRecord(projectId).repoPath,
      files:
        scope.length === 0
          ? files
          : files.filter(({ relPath }) => scope.some((path) => relPath === path || relPath.startsWith(`${path}/`))),
      targetSectionIds: run.targetSectionIds,
    };
  }

  return {
    submitOutline(attempt: AttemptDTO, input: SubmitDesignOutlineInput) {
      const { design } = activeRun(attempt);
      if (design.outlineConfirmedAt !== null)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The project design outline has already been confirmed');
      validateDesignOutline(input.sections, repo.listFiles(design.id));
      const now = clock.now();

      unit.transact(() => {
        repo.deleteSections(design.id);
        repo.insertSections(
          input.sections.map((section, index) => ({
            ...section,
            id: randomUUID(),
            designId: design.id,
            seq: index + 1,
            selected: true,
            summary: '',
            blocks: null,
            reviewState: DesignReviewState.None,
            reviewNotes: null,
            previous: null,
            updatedAt: now,
          })),
        );
        if (input.title !== undefined) repo.updateDesign(design.id, { title: input.title });
        attempts.markSubmitted(attempt.id);
        publish(design.id, now);
      });
      return { accepted: true } as const;
    },

    async submitSection(attempt: AttemptDTO, input: SubmitDesignSectionInput) {
      await validateDesignSection(input, context(attempt, input.sectionId));
      const { run, design } = activeRun(attempt);
      if (!run.targetSectionIds.includes(input.sectionId))
        invalid(['sectionId'], 'Choose a section targeted by this run');
      const section = mustFindSection(design.id, input.sectionId);
      if (run.doneSectionIds.includes(section.id)) invalid(['sectionId'], 'This section has already been submitted');

      const now = clock.now();
      const files = repo.listFiles(design.id);
      const oldDiagrams = repo.listDiagrams(design.id).filter(({ sectionId }) => sectionId === section.id);
      const oldDiagramIds = new Set(oldDiagrams.map(({ id }) => id));
      const diagramIds = new Map(input.diagrams.map(({ id }) => [id, oldDiagramIds.has(id) ? id : randomUUID()]));
      const diagramId = (id: string) => {
        const assigned = diagramIds.get(id);
        if (assigned === undefined) throw new Error('Validated diagram has no storage identifier');
        return assigned;
      };
      const done = [...run.doneSectionIds, section.id];
      const remainingSectionIds = run.targetSectionIds.filter((id) => !done.includes(id));

      unit.transact(() => {
        const content = {
          summary: input.summary,
          files: input.files,
          blocks: input.blocks.map((block) =>
            block.type === 'diagram_ref' ? { ...block, diagramId: diagramId(block.diagramId) } : block,
          ),
          diagrams: input.diagrams.map((diagram) => ({ ...diagram, id: diagramId(diagram.id) })),
        };
        const previous =
          attempt.kind === AttemptKind.DesignRevise ? snapshotSection(section, files, oldDiagrams) : section.previous;
        replaceSectionContent(repo, section, files, content, previous, now);
        repo.updateRunDone(run.id, done);
        if (remainingSectionIds.length === 0) attempts.markSubmitted(attempt.id);
        publish(design.id, now);
      });
      return { remainingSectionIds };
    },

    async submitReview(attempt: AttemptDTO, input: SubmitDesignReviewInput) {
      await validateDesignReview(input, context(attempt));
      const { run, design } = activeRun(attempt);
      const now = clock.now();
      const sections = new Map(repo.listSections(design.id).map((section) => [section.id, section]));
      const findings = new Map(input.findings.map((item) => [item.sectionId, item]));
      input.findings.forEach((item, index) => {
        if (!run.targetSectionIds.includes(item.sectionId))
          invalid(['findings', index, 'sectionId'], 'Choose a section targeted by this run');
      });
      const updates = run.targetSectionIds.map((sectionId) => {
        const section = sections.get(sectionId);
        if (section === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
        const finding = findings.get(sectionId);
        return {
          ...section,
          reviewState: finding?.reviewState ?? DesignReviewState.None,
          reviewNotes: finding?.notes ?? null,
          updatedAt: now,
        };
      });

      unit.transact(() => {
        for (const section of updates) repo.updateSection(section);
        repo.updateRunDone(run.id, [...findings.keys()]);
        attempts.markSubmitted(attempt.id);
        publish(design.id, now);
      });
      return { accepted: true } as const;
    },
  };
}

export type DesignSubmissions = ReturnType<typeof createDesignSubmissions>;
