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
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import { SessionPurpose } from '../opencode/index.ts';
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
type GenerationPlan = ReadonlySet<string>;
type FollowUp = { kind: 'generate'; plan: GenerationPlan } | { kind: 'review' };
type Work = {
  kind: DesignAttemptKind;
  targets: DesignSection[];
  prompt: string;
  instruction?: string | undefined;
  model: string | null;
  generation?: GenerationPlan;
};

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
  // 只记录本次请求的章节。重启后从已保存章节续作，不恢复未完成的内存队列。
  const generations = new Map<string, GenerationPlan>();
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
      ...(title === PromptName.DesignSection
        ? {
            outline: repo.listSections(design.id).map(({ id, seq, selected, kind, title, scopePaths }) => ({
              id,
              seq,
              selected,
              kind,
              title,
              scopePaths,
            })),
          }
        : {}),
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
      if (work.generation !== undefined) generations.set(id, work.generation);
      publish(design.id);
      return started;
    });
  }

  function generateWork(design: ProjectDesign, target: DesignSection, model: string | null, plan: GenerationPlan) {
    return run(design, {
      kind: AttemptKind.DesignGenerate,
      targets: [target],
      model,
      generation: plan,
      prompt: `${promptFor(design, PromptName.DesignSection, [target])}\n本轮目标章节 ID：${target.id}`,
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

  async function handoff(runRecord: DesignRun, model: string | null, next: FollowUp) {
    await attempts.waitForSessionRelease(runRecord.attemptId);
    if (handoffs.get(runRecord.designId) !== runRecord) return;
    handoffs.delete(runRecord.designId);
    const design = repo.findDesign(runRecord.designId);
    if (closed || design?.projectId == null || latestRun(design.id)?.id !== runRecord.id || !attempts.isReady()) {
      publish(runRecord.designId);
      return;
    }
    const selected = selectedSections(design.id);
    const remaining = selected.filter((section) => section.blocks === null);
    if (next.kind === 'generate') {
      const target = remaining.find(({ id }) => next.plan.has(id));
      if (target !== undefined) {
        await generateWork(design, target, model, next.plan);
        return;
      }
    } else if (design.aiReviewEnabled && selected.length > 0 && remaining.length === 0) {
      await reviewWork(design, selected, model);
      return;
    }
    publish(design.id);
  }

  function scheduleHandoff(work: DesignRun, plan: GenerationPlan, model: string | null) {
    if (latestRun(work.designId)?.id !== work.id || work.doneSectionIds.length === 0) return;
    const design = repo.findDesign(work.designId);
    if (design?.projectId == null) return;
    const selected = selectedSections(design.id);
    const remaining = selected.filter((section) => section.blocks === null);
    const next: FollowUp | undefined = remaining.some(({ id }) => plan.has(id))
      ? { kind: 'generate', plan }
      : design.aiReviewEnabled && selected.length > 0 && remaining.length === 0
        ? { kind: 'review' }
        : undefined;
    if (next === undefined) return;
    handoffs.set(design.id, work);
    void handoff(work, model, next).catch((error: unknown) => {
      log.error({ err: error, designId: design.id, attemptId: work.attemptId }, 'design follow-up failed');
      publish(design.id);
    });
  }

  const unsubscribe = attempts.onSignal(({ type, attempt }) => {
    if (!isDesignAttemptKind(attempt.kind)) return;
    const work = repo.findRunByAttempt(attempt.id);
    if (work === undefined) return;
    if (type === 'ended') {
      const plan = generations.get(attempt.id);
      generations.delete(attempt.id);
      repo.updateDesign(work.designId, { updatedAt: clock.now() });
      if (!closed && plan !== undefined && !stopping.has(work.designId) && attempt.status === AttemptStatus.Succeeded) {
        scheduleHandoff(work, plan, attempt.model);
      }
    }
    publish(work.designId);
  });

  return {
    assertIdle,
    hasPendingHandoff: (id: string) => handoffs.has(id),
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
      const sections = repo.listSections(id);
      if (design.outlineConfirmedAt === null) {
        if (input.sectionId !== undefined) invalidState('Confirm the outline before retrying a section');
        if (!sections.some((item) => item.selected)) {
          throw new AppError(ErrorCode.ValidationFailed, 'The outline has no selected sections', {
            issues: [{ path: ['sections'], message: 'Select at least one chapter before confirming the outline' }],
          });
        }
      }
      if (design.sourceSnapshot.analyzableCount === 0) invalidState('The project has no analyzable source files');
      const section = input.sectionId === undefined ? undefined : sections.find(({ id }) => id === input.sectionId);
      if (input.sectionId !== undefined && section === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
      const targets = (section === undefined ? sections : [section]).filter(
        (item) => item.selected && item.blocks === null,
      );
      const target = targets[0];
      if (target === undefined) invalidState('Select at least one unfinished section to generate');
      await generateWork(design, target, modelFor(input), new Set(targets.map(({ id }) => id)));
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
      if (handoffs.delete(id)) {
        publish(id);
        return;
      }
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
      generations.clear();
      unsubscribe();
    },
  };
}

export type DesignRuns = ReturnType<typeof createDesignRuns>;
