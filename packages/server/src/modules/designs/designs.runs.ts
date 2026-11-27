import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  ATTEMPT_SUBMIT_TOOL,
  AttemptKind,
  AttemptStatus,
  DESIGN_MAX_SECTIONS,
  DESIGN_REVIEW_BATCH_SIZE,
  type DesignAttemptKind,
  ErrorCode,
  type IncrementalUpdateDesignRequest,
  isAttemptActive,
  isDesignAttemptKind,
  MCP_TOOL_PREFIX,
  ServerEventType,
  SessionAgent,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DatabasesService } from '../databases/index.ts';
import { SessionPurpose } from '../opencode/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { type FrozenDesignUpdate, filesForDesignUpdateSection, freezeDesignUpdate } from './designs.incremental.ts';
import { designScope, planningInventory } from './designs.planning.ts';
import { promptSections } from './designs.prompt-section.ts';
import type { createDesignsRepo, DesignRun, DesignSection, ProjectDesign } from './designs.repo.ts';
import { isDataExplorerSectionRun } from './designs.templates.ts';

type Dependencies = {
  repo: ReturnType<typeof createDesignsRepo>;
  attempts: Pick<
    AttemptsService,
    'abort' | 'dispatchObjectAttempt' | 'get' | 'onSignal' | 'requireReady' | 'isReady' | 'waitForSessionRelease'
  >;
  projects: Pick<ProjectsService, 'getRecord'>;
  databases: Pick<DatabasesService, 'linkedIds'>;
  unit: UnitOfWork;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  prompts: Prompts;
  log: Logger;
};

type ModelInput = { model?: string | null | undefined };
type GenerateInput = ModelInput & { sectionId?: string | undefined };
type ReviseOutlineInput = ModelInput & {
  instruction?: string | undefined;
  generateAfterPlanning?: boolean | undefined;
};
type ReviseSectionInput = ModelInput & {
  instruction: string;
  focusPath?: string | undefined;
  focusSymbol?: string | undefined;
  focusDiagramId?: string | undefined;
};
type GenerationPlan = ReadonlySet<string>;
type IncrementalPlan = {
  frozen: FrozenDesignUpdate;
  sourceDir: string;
  remaining: readonly string[];
  advance: boolean;
  instruction: string | undefined;
};
type FollowUp =
  | { kind: 'incremental'; plan: IncrementalPlan }
  | { kind: 'planned' }
  | { kind: 'generate'; plan: GenerationPlan }
  | { kind: 'review'; sectionIds: readonly string[] };
type Work = {
  kind: DesignAttemptKind;
  targets: DesignSection[];
  prompt: string;
  instruction?: string | undefined;
  model: string | null;
  followUp?: FollowUp;
};

function invalidState(message: string): never {
  throw new AppError(ErrorCode.StateTransitionInvalid, message);
}

export function createDesignRuns({
  repo,
  attempts,
  projects,
  databases,
  unit,
  clock,
  settings,
  prompts,
  log,
}: Dependencies) {
  const handoffs = new Map<string, DesignRun>();
  // 只记录本次请求的章节。重启后从已保存章节续作，不恢复未完成的内存队列。
  const followUps = new Map<string, FollowUp>();
  const stopping = new Set<string>();
  const freezing = new Map<string, AbortController>();
  const sources = new Set<string>();
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
      freezing.has(id) ||
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
    sections: DesignSection[] = targets,
    frozen?: FrozenDesignUpdate,
  ) {
    const inScope = designScope(targets);
    const inventory = repo.fileInventory(design.id);
    const [target] = targets;
    const files =
      frozen !== undefined && target !== undefined
        ? filesForDesignUpdateSection(target, frozen, inventory).map(({ relPath, sectionId }) => ({
            relPath,
            sectionId,
          }))
        : inventory.filter(({ relPath }) => targets.length === 0 || inScope(relPath));
    const context = {
      title: design.title,
      depth: design.depth,
      analysisFocus: design.templateSnapshot.focusPrompt,
      source: frozen?.targetSnapshot ?? design.sourceSnapshot,
      sections: promptSections(repo, sections),
      ...(title === PromptName.DesignSection
        ? {
            outline: repo.listSections(design.id).map(({ id, seq, selected, kind, title }) => ({
              id,
              seq,
              selected,
              kind,
              title,
            })),
          }
        : {}),
      ...planningInventory(files),
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
      designDatabaseMetadata: isDataExplorerSectionRun(work.kind, design) && databases.linkedIds(project.id).length > 0,
      directory: work.followUp?.kind === 'incremental' ? work.followUp.plan.sourceDir : project.repoPath,
      title: `Project Design · ${design.title}`,
      model: work.model,
      prompt: work.prompt,
      designContinuation: {
        title: design.title,
        prompt: renderTemplate(prompts[PromptName.DesignContinue], {
          targets: JSON.stringify(work.targets.map(({ id, title }) => ({ id, title }))),
          submitTool: MCP_TOOL_PREFIX + ATTEMPT_SUBMIT_TOOL[work.kind],
        }),
      },
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
        isIncremental: work.followUp?.kind === 'incremental',
        instruction: work.instruction ?? null,
        createdAt: now,
      });
      repo.updateDesign(design.id, {
        updatedAt: now,
        ...(work.kind === AttemptKind.DesignGenerate && design.outlineConfirmedAt === null
          ? { outlineConfirmedAt: now }
          : {}),
      });
      if (work.followUp !== undefined) followUps.set(id, work.followUp);
      publish(design.id);
      return started;
    });
  }

  function generateWork(design: ProjectDesign, target: DesignSection, model: string | null, plan: GenerationPlan) {
    return run(design, {
      kind: AttemptKind.DesignGenerate,
      targets: [target],
      model,
      followUp: { kind: 'generate', plan },
      prompt: `${promptFor(design, PromptName.DesignSection, [target])}\n本轮目标章节 ID：${target.id}`,
    });
  }

  function incrementalWork(design: ProjectDesign, target: DesignSection, model: string | null, plan: IncrementalPlan) {
    const isRevision = target.blocks !== null;
    const title = isRevision ? PromptName.DesignRevise : PromptName.DesignSection;
    const { frozen, instruction } = plan;
    const changes = planningInventory(frozen.changes);
    return run(design, {
      kind: isRevision ? AttemptKind.DesignRevise : AttemptKind.DesignGenerate,
      targets: [target],
      model,
      instruction,
      followUp: { kind: 'incremental', plan },
      prompt:
        `${promptFor(design, title, [target], [target], frozen)}\n本轮目标章节 ID：${target.id}` +
        '\n按启动时冻结的源码清单核对并更新本章。删除的文件不再作为证据。' +
        `\n扫描发现 ${changes.fileCount} 个变化文件，变更样本：${JSON.stringify(changes.authorizedFiles)}` +
        `\n用户补充要求：${JSON.stringify(instruction ?? '')}`,
    });
  }

  function reviewWork(design: ProjectDesign, sections: DesignSection[], model: string | null) {
    const targets = sections.slice(0, DESIGN_REVIEW_BATCH_SIZE);
    const remaining = sections.slice(DESIGN_REVIEW_BATCH_SIZE);
    return run(design, {
      kind: AttemptKind.DesignReview,
      ...(remaining.length ? { followUp: { kind: 'review' as const, sectionIds: remaining.map(({ id }) => id) } } : {}),
      targets,
      model,
      prompt: promptFor(design, PromptName.DesignReview, targets),
    });
  }

  async function handoff(runRecord: DesignRun, model: string | null, next: Exclude<FollowUp, { kind: 'incremental' }>) {
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
    if (next.kind !== 'review') {
      const plan = next.kind === 'planned' ? new Set(remaining.map(({ id }) => id)) : next.plan;
      const target = remaining.find(({ id }) => plan.has(id));
      if (target !== undefined) {
        await generateWork(design, target, model, plan);
        return;
      }
    } else {
      const batch = selected.filter(({ id }) => next.sectionIds.includes(id));
      if (batch.length > 0) await reviewWork(design, batch, model);
      return;
    }
    publish(design.id);
  }

  async function removeSource(sourceDir: string) {
    await rm(sourceDir, { recursive: true, force: true });
    sources.delete(sourceDir);
  }

  async function finishIncremental(work: DesignRun, model: string | null, plan: IncrementalPlan) {
    const id = work.designId;
    let transferred = false;
    try {
      await attempts.waitForSessionRelease(work.attemptId);
      if (handoffs.get(id) !== work) return;
      const design = repo.findDesign(id);
      if (design?.projectId == null || latestRun(id)?.id !== work.id) return;

      const [targetId, ...remaining] = plan.remaining;
      if (targetId === undefined || !attempts.isReady()) return;
      const target = repo.listSections(id).find((section) => section.id === targetId);
      if (target === undefined) throw new AppError(ErrorCode.DesignSectionNotFound);
      // 新尝试同步写入，之后由其活跃状态保持互斥。
      handoffs.delete(id);
      const started = incrementalWork(design, target, model, { ...plan, remaining });
      transferred = true;
      await started;
    } finally {
      if (handoffs.get(id) === work) handoffs.delete(id);
      publish(id);
      if (!transferred) await removeSource(plan.sourceDir);
    }
  }

  function scheduleHandoff(
    work: DesignRun,
    followUp: Exclude<FollowUp, { kind: 'incremental' }>,
    model: string | null,
  ) {
    if (latestRun(work.designId)?.id !== work.id) return;
    const design = repo.findDesign(work.designId);
    if (design?.projectId == null) return;
    let next: typeof followUp | undefined = followUp;
    if (followUp.kind === 'generate') {
      if (work.doneSectionIds.length === 0) return;
      const selected = selectedSections(design.id);
      const remaining = selected.filter((section) => section.blocks === null);
      if (!remaining.some(({ id }) => followUp.plan.has(id))) {
        next =
          design.aiReviewEnabled && remaining.length === 0
            ? { kind: 'review', sectionIds: selected.map(({ id }) => id) }
            : undefined;
      }
    }
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
      const followUp = followUps.get(attempt.id);
      followUps.delete(attempt.id);
      repo.updateDesign(work.designId, { updatedAt: clock.now() });
      const canContinue = !closed && !stopping.has(work.designId) && attempt.status === AttemptStatus.Succeeded;
      if (followUp?.kind === 'incremental') {
        if (canContinue && work.doneSectionIds.length > 0 && followUp.plan.remaining.length > 0)
          handoffs.set(work.designId, work);
        void finishIncremental(work, attempt.model, followUp.plan).catch((error: unknown) => {
          log.error(
            { err: error, designId: work.designId, attemptId: attempt.id },
            'design incremental follow-up failed',
          );
        });
      } else if (canContinue && followUp !== undefined) {
        scheduleHandoff(work, followUp, attempt.model);
      }
    }
    publish(work.designId);
  });

  return {
    assertIdle,
    hasPendingHandoff: (id: string) => handoffs.has(id) || freezing.has(id),
    incrementalFor(attemptId: string) {
      const followUp = followUps.get(attemptId);
      if (followUp?.kind !== 'incremental') return undefined;
      const { frozen, advance, remaining } = followUp.plan;
      return { frozen, advancesSnapshot: advance && remaining.length === 0 };
    },

    async incrementalUpdate(id: string, { sectionIds, instruction }: Omit<IncrementalUpdateDesignRequest, 'id'>) {
      const design = mustFindDesign(id);
      assertIdle(id);
      if (closed) invalidState('Application is shutting down');
      if (design.projectId === null) invalidState('Design is read-only because its project was deleted');
      if (design.outlineConfirmedAt === null) invalidState('Confirm the outline before updating sections');
      attempts.requireReady();
      const { repoPath } = projects.getRecord(design.projectId);
      const controller = new AbortController();
      freezing.set(id, controller);
      publish(id);
      let sourceDir: string | undefined;
      try {
        sourceDir = await mkdtemp(join(tmpdir(), 'aw-design-update-'));
        const frozen = await freezeDesignUpdate(repo, design, repoPath, clock.now(), sourceDir);
        if (closed || controller.signal.aborted) invalidState('The project design update was stopped');
        if (repo.findDesign(id)?.projectId !== design.projectId)
          invalidState('Design is read-only because its project was deleted');
        const selected = new Set(sectionIds);
        const affected = new Set(frozen.affectedSectionIds);
        const [first, ...others] = selectedSections(id).filter((section) => selected.has(section.id));
        if (first === undefined || sectionIds.some((sectionId) => !affected.has(sectionId)))
          throw new AppError(ErrorCode.ValidationFailed, 'Choose affected sections from the current source changes', {
            issues: [{ path: ['sectionIds'], message: 'Select chapters still affected by the current source changes' }],
          });
        const started = incrementalWork(design, first, modelFor({}), {
          frozen,
          sourceDir,
          instruction,
          remaining: others.map((section) => section.id),
          advance: frozen.affectedSectionIds.every((sectionId) => selected.has(sectionId)),
        });
        sources.add(sourceDir);
        sourceDir = undefined;
        freezing.delete(id);
        await started;
      } finally {
        if (freezing.get(id) === controller) freezing.delete(id);
        publish(id);
        if (sourceDir !== undefined) await removeSource(sourceDir);
      }
    },
    async reviseOutline(id: string, input: ReviseOutlineInput) {
      const design = mustFindDesign(id);
      assertIdle(id);
      if (design.outlineConfirmedAt !== null) invalidState('The design outline is already confirmed');
      const sections = repo.listSections(id);
      if (
        input.generateAfterPlanning &&
        (design.sourceSnapshot.analyzableCount === 0 || sections.some((s) => !s.selected))
      )
        invalidState('Automatic planning requires analyzable files and a fully selected draft');
      await run(design, {
        kind: AttemptKind.DesignOutline,
        ...(input.generateAfterPlanning ? { followUp: { kind: 'planned' as const } } : {}),
        targets: [],
        prompt:
          promptFor(design, PromptName.DesignOutline, [], sections) +
          `\n可提交 1 至 ${DESIGN_MAX_SECTIONS} 个章节，每章由一个独立生成会话执行。\n用户对大纲的补充要求：${JSON.stringify(input.instruction ?? '')}`,
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
      const files = repo.fileInventory(id);
      const diagrams = repo.listDiagrams(id).filter((item) => item.sectionId === section.id);
      if (
        input.focusPath !== undefined &&
        !files.some(({ relPath }) => relPath === input.focusPath && designScope([section])(relPath))
      )
        invalidState('The focused file is outside the section source inventory');
      if (input.focusDiagramId !== undefined && !diagrams.some(({ id }) => id === input.focusDiagramId))
        invalidState('The focused diagram does not belong to this section');
      const { model: _model, ...focus } = input;
      await run(design, {
        kind: AttemptKind.DesignRevise,
        targets: [section],
        prompt: `${promptFor(design, PromptName.DesignRevise, [section])}\n\n${JSON.stringify({ focus })}`,
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
      const controller = freezing.get(id);
      if (controller !== undefined) {
        controller.abort();
        return;
      }
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

    async close() {
      closed = true;
      handoffs.clear();
      followUps.clear();
      unsubscribe();
      await Promise.all([...sources].map(removeSource));
    },
  };
}

export type DesignRuns = ReturnType<typeof createDesignRuns>;
