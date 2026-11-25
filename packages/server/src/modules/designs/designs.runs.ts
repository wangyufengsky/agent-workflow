import { randomUUID } from 'node:crypto';
import { PromptName, type Prompts } from '@aw/builtin';
import {
  AppError,
  AttemptKind,
  AttemptStatus,
  type DesignAttemptKind,
  ErrorCode,
  isAttemptActive,
  isDesignAttemptKind,
  ServerEventType,
  SessionAgent,
} from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import { CONTEXT_OVERFLOW_ERROR, SessionPurpose } from '../opencode/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { createDesignsRepo, DesignRun, DesignSection, ProjectDesign } from './designs.repo.ts';

type Dependencies = {
  repo: ReturnType<typeof createDesignsRepo>;
  attempts: Pick<
    AttemptsService,
    'abort' | 'dispatchObjectAttempt' | 'get' | 'onSignal' | 'requireReady' | 'isReady' | 'waitForSessionRelease'
  >;
  projects: Pick<ProjectsService, 'getRecord'>;
  unit: UnitOfWork;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  prompts: Prompts;
  log: Logger;
};

type ModelInput = { model?: string | null | undefined };
type GenerateInput = ModelInput & { sectionId?: string | undefined };
type ReviseOutlineInput = ModelInput & { instruction?: string | undefined };
type ReviseSectionInput = ModelInput & {
  instruction: string;
  focusPath?: string | undefined;
  focusSymbol?: string | undefined;
  focusDiagramId?: string | undefined;
};
type PromptSection = Omit<DesignSection, 'reviewState' | 'reviewNotes' | 'previous' | 'updatedAt' | 'designId'>;
type Work = {
  kind: DesignAttemptKind;
  targets: DesignSection[];
  prompt: string;
  instruction?: string | undefined;
  model: string | null;
};

const overflowDetailsSchema = z.object({ error: z.object({ name: z.literal(CONTEXT_OVERFLOW_ERROR) }) });

const promptSection = ({
  id,
  seq,
  selected,
  kind,
  title,
  scopePaths,
  summary,
  blocks,
}: DesignSection): PromptSection => ({
  id,
  seq,
  selected,
  kind,
  title,
  scopePaths,
  summary,
  blocks,
});

const scopedTo = (path: string, { scopePaths }: DesignSection) =>
  scopePaths.length === 0 || scopePaths.some((scope) => path === scope || path.startsWith(`${scope}/`));

function invalidState(message: string): never {
  throw new AppError(ErrorCode.StateTransitionInvalid, message);
}

export function createDesignRuns({ repo, attempts, projects, unit, clock, settings, prompts, log }: Dependencies) {
  const handoffs = new Map<string, DesignRun>();
  const stopping = new Set<string>();
  let closed = false;

  function latestRun(id: string) {
    return repo.listRuns(id).at(-1);
  }

  function mustFindDesign(id: string) {
    const design = repo.findDesign(id);
    if (design === undefined) throw new AppError(ErrorCode.DesignNotFound);
    return design;
  }

  function assertIdle(id: string): void {
    const latest = latestRun(id);
    if (
      handoffs.has(id) ||
      stopping.has(id) ||
      (latest !== undefined && isAttemptActive(attempts.get(latest.attemptId).status))
    )
      throw new AppError(ErrorCode.DesignBusy);
  }

  function selectedSections(id: string): DesignSection[] {
    return repo.listSections(id).filter((section) => section.selected);
  }

  function publish(designId: string) {
    unit.publish({ type: ServerEventType.DesignUpdated, data: { designId } });
  }

  function modelFor(input: ModelInput) {
    return input.model === undefined ? settings.get('ai.defaultModel') : input.model;
  }

  function promptFor(
    design: ProjectDesign,
    title: PromptName,
    targets: DesignSection[],
    sections: PromptSection[] = targets.map(promptSection),
  ) {
    const files = repo
      .listFiles(design.id)
      .filter(({ relPath }) => targets.length === 0 || targets.some((section) => scopedTo(relPath, section)))
      .map(({ relPath, sectionId }) => ({ relPath, sectionId }));
    const context = {
      title: design.title,
      depth: design.depth,
      analysisFocus: design.templateSnapshot.focusPrompt,
      source: design.sourceSnapshot,
      sections,
      authorizedFiles: files,
    };
    return `${prompts[title]}\n\n本轮分析数据：\n${JSON.stringify(context)}`;
  }

  function run(design: ProjectDesign, work: Work): Promise<unknown> {
    if (closed) invalidState('Application is shutting down');
    if (design.projectId === null) invalidState('Design is read-only because its project was deleted');
    attempts.requireReady();
    const project = projects.getRecord(design.projectId);
    const previous = latestRun(design.id);
    const id = randomUUID();
    const now = clock.now();
    const first = {
      id,
      kind: work.kind,
      agent: SessionAgent.Designer,
      taskId: null,
      nodeId: null,
      roleId: null,
      projectId: project.id,
      directory: project.repoPath,
      title: `Project Design · ${design.title}`,
      model: work.model,
      prompt: work.prompt,
    } as const;

    return unit.transact(() => {
      // The attempt row is inserted synchronously before OpenCode can send the first tool call.
      const started = attempts.dispatchObjectAttempt({
        purpose: SessionPurpose.Design,
        previousId: previous?.attemptId,
        first: () => first,
        followUp: () => ({ ...first, system: undefined }),
      });
      repo.insertRun({
        id: randomUUID(),
        designId: design.id,
        seq: (previous?.seq ?? 0) + 1,
        attemptId: id,
        targetSectionIds: work.targets.map((section) => section.id),
        doneSectionIds: [],
        instruction: work.instruction ?? null,
        createdAt: now,
      });
      repo.updateDesign(design.id, {
        updatedAt: now,
        ...(work.kind === AttemptKind.DesignGenerate && design.outlineConfirmedAt === null
          ? { outlineConfirmedAt: now }
          : {}),
      });
      publish(design.id);
      return started;
    });
  }

  function generateWork(design: ProjectDesign, targets: DesignSection[], model: string | null) {
    const outline = repo.listSections(design.id).map((section) => ({ ...promptSection(section), blocks: null }));
    return run(design, {
      kind: AttemptKind.DesignGenerate,
      targets,
      model,
      prompt:
        promptFor(design, PromptName.DesignSection, targets, outline) +
        `\n目标章节 ID（依次提交）：${JSON.stringify(targets.map((section) => section.id))}`,
    });
  }

  function reviewWork(design: ProjectDesign, targets: DesignSection[], model: string | null) {
    const ids = new Set(targets.map(({ id }) => id));
    const files = repo.listFiles(design.id).filter(({ sectionId }) => sectionId !== null && ids.has(sectionId));
    const diagrams = repo.listDiagrams(design.id).filter(({ sectionId }) => ids.has(sectionId));
    return run(design, {
      kind: AttemptKind.DesignReview,
      targets,
      model,
      prompt:
        promptFor(design, PromptName.DesignReview, targets) +
        `\n已生成的文件与图：${JSON.stringify({ files, diagrams })}`,
    });
  }

  async function handoff(runRecord: DesignRun, model: string | null, continuation: 'generate' | 'review') {
    await attempts.waitForSessionRelease(runRecord.attemptId);
    if (handoffs.get(runRecord.designId) !== runRecord) return;
    handoffs.delete(runRecord.designId);
    const design = repo.findDesign(runRecord.designId);
    if (closed || !design?.projectId || latestRun(design.id)?.id !== runRecord.id || !attempts.isReady()) return;
    const selected = selectedSections(design.id);
    const remaining = selected.filter((section) => section.blocks === null);
    if (continuation === 'generate') {
      const targets = remaining.filter((section) => runRecord.targetSectionIds.includes(section.id));
      if (targets.length > 0) await generateWork(design, targets, model);
    } else if (design.aiReviewEnabled && selected.length > 0 && remaining.length === 0) {
      await reviewWork(design, selected, model);
    }
  }

  const unsubscribe = attempts.onSignal(({ type, attempt }) => {
    if (!isDesignAttemptKind(attempt.kind)) return;
    const work = repo.findRunByAttempt(attempt.id);
    if (work === undefined) return;
    if (type === 'ended') repo.updateDesign(work.designId, { updatedAt: clock.now() });
    publish(work.designId);
    if (
      closed ||
      type !== 'ended' ||
      attempt.kind !== AttemptKind.DesignGenerate ||
      stopping.has(work.designId) ||
      latestRun(work.designId)?.id !== work.id
    )
      return;
    const design = repo.findDesign(work.designId);
    if (design?.projectId == null) return;
    const selected = selectedSections(design.id);
    const overflow =
      attempt.error?.code === ErrorCode.AttemptContextBudget ||
      (attempt.error?.code === ErrorCode.AttemptSessionError &&
        overflowDetailsSchema.safeParse(attempt.error.details).success);
    const needsContinuation =
      overflow &&
      attempt.status === AttemptStatus.Failed &&
      work.doneSectionIds.length > 0 &&
      selected.some((section) => section.blocks === null && work.targetSectionIds.includes(section.id));
    const needsReview =
      attempt.status === AttemptStatus.Succeeded &&
      design.aiReviewEnabled &&
      selected.length > 0 &&
      selected.every((section) => section.blocks !== null);
    if (!needsContinuation && !needsReview) return;
    handoffs.set(design.id, work);
    void handoff(work, attempt.model, needsContinuation ? 'generate' : 'review').catch((error: unknown) => {
      log.error({ err: error, designId: design.id, attemptId: attempt.id }, 'design follow-up failed');
    });
  });

  return {
    assertIdle,
    async reviseOutline(id: string, input: ReviseOutlineInput) {
      const design = mustFindDesign(id);
      assertIdle(id);
      if (design.outlineConfirmedAt !== null) invalidState('The design outline is already confirmed');
      const sections = repo.listSections(id);
      await run(design, {
        kind: AttemptKind.DesignOutline,
        targets: [],
        prompt:
          promptFor(design, PromptName.DesignOutline, [], sections.map(promptSection)) +
          `\n用户对大纲的补充要求：${JSON.stringify(input.instruction ?? '')}`,
        instruction: input.instruction,
        model: modelFor(input),
      });
    },

    async generate(id: string, input: GenerateInput) {
      const design = mustFindDesign(id);
      assertIdle(id);
      if (repo.listFiles(id).length === 0) invalidState('The project has no analyzable source files');
      const sections = repo.listSections(id);
      const section = input.sectionId === undefined ? undefined : sections.find(({ id }) => id === input.sectionId);
      if (input.sectionId !== undefined && section === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
      const targets = (section === undefined ? sections : [section]).filter(
        (item) => item.selected && item.blocks === null,
      );
      if (targets.length === 0) invalidState('Select at least one unfinished section to generate');
      await generateWork(design, targets, modelFor(input));
    },

    async reviseSection(id: string, sectionId: string, input: ReviseSectionInput) {
      const design = mustFindDesign(id);
      assertIdle(id);
      const section = repo.listSections(id).find((item) => item.id === sectionId);
      if (section === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
      if (!section.selected || section.blocks === null) invalidState('This section has no generated content to revise');
      const files = repo.listFiles(id);
      const diagrams = repo.listDiagrams(id).filter((item) => item.sectionId === section.id);
      if (
        input.focusPath !== undefined &&
        !files.some(({ relPath }) => relPath === input.focusPath && scopedTo(relPath, section))
      )
        invalidState('The focused file is outside the section source inventory');
      if (input.focusDiagramId !== undefined && !diagrams.some(({ id }) => id === input.focusDiagramId))
        invalidState('The focused diagram does not belong to this section');
      const { model: _model, ...focus } = input;
      await run(design, {
        kind: AttemptKind.DesignRevise,
        targets: [section],
        prompt:
          promptFor(design, PromptName.DesignRevise, [section]) +
          '\n\n' +
          JSON.stringify({ focus, files: files.filter((file) => file.sectionId === sectionId), diagrams }),
        instruction: input.instruction,
        model: modelFor(input),
      });
    },

    async review(id: string, input: ModelInput) {
      const design = mustFindDesign(id);
      assertIdle(id);
      const targets = selectedSections(id);
      if (
        design.outlineConfirmedAt === null ||
        targets.length === 0 ||
        targets.some((section) => section.blocks === null)
      )
        invalidState('Generate all selected sections before requesting a review');
      await reviewWork(design, targets, modelFor(input));
    },

    async stop(id: string) {
      mustFindDesign(id);
      if (handoffs.delete(id)) return;
      if (stopping.has(id)) throw new AppError(ErrorCode.DesignBusy);
      const latest = latestRun(id);
      if (latest === undefined || !isAttemptActive(attempts.get(latest.attemptId).status))
        invalidState('No active project design run');
      stopping.add(id);
      try {
        await attempts.abort(latest.attemptId);
      } finally {
        stopping.delete(id);
      }
    },

    close() {
      closed = true;
      handoffs.clear();
      unsubscribe();
    },
  };
}

export type DesignRuns = ReturnType<typeof createDesignRuns>;
