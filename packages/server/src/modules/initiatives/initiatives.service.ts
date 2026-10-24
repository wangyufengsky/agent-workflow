import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { BuiltinRoleKey, type Prompts } from '@aw/builtin';
import {
  AppError,
  AttachmentOwnerKind,
  type AttemptDTO,
  AttemptKind,
  attemptMachine,
  type CreateInitiativeRequest,
  createInitiativeRequestSchema,
  type DeliverInitiativePhaseResponse,
  DeliveryStrategy,
  ErrorCode,
  INITIATIVE_BACKGROUND_NAME,
  INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS,
  INITIATIVE_KEY_PREFIX,
  INITIATIVE_TITLE_MAX_CHARS,
  type InitiativeDetailDTO,
  type InitiativeDraft,
  type InitiativeItemDTO,
  type InitiativeItemSpec,
  InitiativeItemStatus,
  type InitiativeProblem,
  InitiativeProblemCode,
  type InitiativeRunDTO,
  InitiativeRunMode,
  InitiativeStatus,
  type InitiativeSummaryDTO,
  type InitiativeTemplateDTO,
  initiativeItemStatusOf,
  initiativeStatusOf,
  isBatchDeliverable,
  isInitiativeItemDone,
  isTerminalState,
  type ListInitiativesQuery,
  type LocalMergeStrategy,
  MCP_TOOL_PREFIX,
  McpToolName,
  type ReadAttachmentOutput,
  renderTemplateRequirement,
  ServerEventType,
  SessionAgent,
  type SubmitBreakdownInput,
  validateInitiativeDraft,
  WorkflowDeliverable,
  type WorkflowDTO,
  WorkflowKind,
  type WorkflowSummaryDTO,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttachmentsService } from '../attachments/index.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { type DoneItem, renderBackground } from './initiatives.background.ts';
import {
  draftOf,
  type RefineItem,
  rebreakdownStep,
  refineStep,
  retryStep,
  startMessage,
} from './initiatives.breakdown.ts';
import {
  createInitiativesRepo,
  type Initiative,
  type InitiativeItem,
  type InitiativeRun,
  itemColumns,
} from './initiatives.repo.ts';
import { createInitiativeTemplates } from './initiatives.templates.ts';

export type InitiativesServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  events: EventBus;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  workflows: WorkflowsService;
  tasks: TasksService;
  attachments: AttachmentsService;
  attempts: AttemptsService;
  projects: ProjectsService;
  roles: RolesService;
  prompts: Prompts;
};

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';
const SESSION_TITLE_PREFIX = 'Initiative';
const invalid = (problems: InitiativeProblem[]) =>
  new AppError(ErrorCode.InitiativeBreakdownInvalid, 'The phases and work packages are invalid', { problems });

/** A work package with what its display state is derived from. */
type ItemView = InitiativeItem & { workflow: WorkflowDTO | null; dto: InitiativeItemDTO };

/**
 * Initiatives (34): a requirement split into work packages and phases, each work package one ordinary task. An
 * initiative only groups and orders its tasks: its state is derived from theirs, and it starts a work package's task
 * once its phase is open and what it depends on is merged (D134).
 */
export function createInitiativesService({
  db,
  unit,
  events,
  clock,
  log,
  settings,
  workflows,
  tasks,
  attachments,
  attempts,
  projects,
  roles,
  prompts,
}: InitiativesServiceDeps) {
  const repo = createInitiativesRepo(db);
  const templates = createInitiativeTemplates(repo, unit, clock);
  const owner = (id: string) => ({ kind: AttachmentOwnerKind.Initiative, id });
  const publish = (initiativeId: string) =>
    events.publish({ type: ServerEventType.InitiativeUpdated, data: { initiativeId } });

  function get(id: string): Initiative {
    const initiative = repo.find(id);
    if (initiative === undefined)
      throw new AppError(ErrorCode.InitiativeNotFound, `Initiative ${id} not found`, { id });
    return initiative;
  }

  /** The workflow a work package runs, or null once it no longer exists (a deleted custom workflow). */
  function workflowOf(key: string): WorkflowDTO | null {
    try {
      return workflows.latest(key);
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.WorkflowNotFound) return null;
      throw err;
    }
  }
  const workflowExists = (key: string) => workflowOf(key) !== null;

  /** Every work package with its task, latest delivery and display state (34 §6.1). */
  function views(initiative: Initiative): ItemView[] {
    const items = repo.items(initiative.id);
    const taskIds = items.flatMap((item) => (item.taskId === null ? [] : [item.taskId]));
    const summaries = new Map(tasks.summariesOf(taskIds).map((t) => [t.id, t]));
    const facts = items.map((item) => {
      const task = item.taskId === null ? null : (summaries.get(item.taskId) ?? null);
      // A started one runs the version its task pinned, which stays even when the workflow is deleted later.
      const workflow = task === null ? workflowOf(item.workflowKey) : workflows.get(task.workflow.id);
      const lastDelivery = item.taskId === null ? null : tasks.lastDelivery(item.taskId);
      const itemFacts = {
        droppedAt: item.droppedAt,
        mergeConfirmedAt: item.mergeConfirmedAt,
        task,
        deliverable: workflow?.deliverable ?? null,
        lastDelivery,
      };
      return {
        item,
        workflow,
        task,
        lastDelivery,
        itemFacts,
        done: isInitiativeItemDone(itemFacts, initiative.baseBranch),
      };
    });
    const done = new Set(facts.filter((f) => f.done).map((f) => f.item.key));
    return facts.map(({ item, workflow, task, lastDelivery, itemFacts }) => ({
      ...item,
      workflow,
      dto: {
        key: item.key,
        title: item.title,
        phase: item.phase,
        workflow: item.workflowKey,
        requirement: item.requirement,
        dependsOn: item.dependsOn,
        acceptance: item.acceptance,
        status: initiativeItemStatusOf(itemFacts, {
          baseBranch: initiative.baseBranch,
          phaseOpened: item.phase <= initiative.openedPhase,
          depsDone: item.dependsOn.every((key) => done.has(key)),
        }),
        workflowName: workflow?.name ?? null,
        deliverable: workflow?.deliverable ?? null,
        task,
        lastDelivery,
        startError: item.startError,
        mergeConfirmedAt: item.mergeConfirmedAt,
        droppedAt: item.droppedAt,
        dropReason: item.dropReason,
      },
    }));
  }

  const isDone = (status: InitiativeItemStatus) =>
    status === InitiativeItemStatus.Satisfied || status === InitiativeItemStatus.Dropped;

  /** The latest breakdown or refinement and whether its session is still at work. */
  function latestRun(initiativeId: string): { run: InitiativeRun; attempt: AttemptDTO } | undefined {
    const run = repo.runs(initiativeId).at(-1);
    return run === undefined ? undefined : { run, attempt: attempts.get(run.attemptId) };
  }
  const isBusy = (initiativeId: string) => {
    const latest = latestRun(initiativeId);
    return latest !== undefined && !isTerminalState(attemptMachine, latest.attempt.status);
  };
  function assertIdle(initiativeId: string): void {
    if (isBusy(initiativeId)) {
      throw new AppError(ErrorCode.InitiativeBusy, 'A breakdown of the initiative is under way', { id: initiativeId });
    }
  }

  function statusOf(initiative: Initiative, items: readonly ItemView[]): InitiativeStatus {
    const latest = latestRun(initiative.id);
    return initiativeStatusOf({
      run: latest === undefined ? null : { active: !isTerminalState(attemptMachine, latest.attempt.status) },
      breakdownRev: initiative.breakdownRev,
      confirmedRev: initiative.confirmedRev,
      openedPhase: initiative.openedPhase,
      phaseCount: initiative.phases.length,
      items: items.map((item) => ({ phase: item.phase, done: isDone(item.dto.status) })),
    });
  }

  function summary(initiative: Initiative, items: readonly ItemView[]): InitiativeSummaryDTO {
    return {
      id: initiative.id,
      key: `${INITIATIVE_KEY_PREFIX}${initiative.seq}`,
      title: initiative.title,
      project: { id: initiative.projectId, name: initiative.projectName },
      template: initiative.template,
      status: statusOf(initiative, items),
      phaseCount: initiative.phases.length,
      openedPhase: initiative.openedPhase,
      itemCount: items.length,
      doneCount: items.filter((item) => isDone(item.dto.status)).length,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
    };
  }

  function detail(id: string): InitiativeDetailDTO {
    const initiative = get(id);
    const items = views(initiative);
    return {
      ...summary(initiative, items),
      requirement: initiative.requirement,
      baseBranch: initiative.baseBranch,
      confirmItemPlans: initiative.confirmItemPlans,
      allowedWorkflows: initiative.allowedWorkflows,
      summary: initiative.summary,
      understanding: initiative.understanding,
      coverage: initiative.coverage,
      latestRun: runDto(initiative.id),
      phases: initiative.phases.map((phase, i) => ({ ...phase, opened: i + 1 <= initiative.openedPhase })),
      items: items.map((item) => item.dto),
      attachments: attachments.listByOwner(owner(id)),
    };
  }

  function runDto(initiativeId: string): InitiativeRunDTO | null {
    const latest = latestRun(initiativeId);
    if (latest === undefined) return null;
    const { run, attempt } = latest;
    return {
      seq: run.seq,
      mode: run.mode,
      attemptId: run.attemptId,
      status: attempt.status,
      instruction: run.instruction,
      openPhase: run.openPhase,
      error: attempt.error,
      createdAt: run.createdAt,
    };
  }

  /** What the next work packages learn about one that is done (34 §7). */
  function doneItem(item: ItemView): DoneItem {
    const base = {
      key: item.key,
      title: item.title,
      phase: item.phase,
      workflowName: item.workflow?.name ?? null,
    };
    if (item.droppedAt !== null)
      return { ...base, dropReason: item.dropReason, summary: null, files: [], merged: null };
    const task = item.taskId === null ? null : tasks.detail(item.taskId);
    const delivery = item.dto.lastDelivery;
    const merged =
      delivery === null
        ? null
        : delivery.strategy === DeliveryStrategy.PullRequest && delivery.prUrl !== null
          ? { prUrl: delivery.prUrl }
          : delivery.commitSha !== null
            ? { commitSha: delivery.commitSha, branch: delivery.targetBranch }
            : null;
    return {
      ...base,
      dropReason: null,
      summary: task?.result?.summary ?? null,
      files: task?.result?.files.map((f) => f.path) ?? [],
      merged,
    };
  }

  /**
   * Starts the work package's task (34 §5.3): background attachment, the initiative's sources, the checklist. The task
   * is linked in the transaction that creates it, unless another start linked one first (`expectedTaskId`).
   */
  async function startItem(initiative: Initiative, item: ItemView, all: readonly ItemView[]): Promise<void> {
    const workflow = item.workflow;
    if (workflow === null) {
      throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${item.workflowKey} not found`, {
        key: item.workflowKey,
      });
    }
    const baseBranch = await tasks.checkCreate({
      projectId: initiative.projectId,
      workflowId: workflow.id,
      baseBranch: initiative.baseBranch,
    });
    const text = renderBackground({
      key: `${INITIATIVE_KEY_PREFIX}${initiative.seq}`,
      title: initiative.title,
      requirement: initiative.requirement,
      phases: initiative.phases,
      item,
      done: all.filter((other) => isDone(other.dto.status)).map(doneItem),
      others: all.filter((other) => other.key !== item.key && !isDone(other.dto.status)),
    });
    const bytes = Buffer.from(text, 'utf8');
    const background = await attachments.upload(INITIATIVE_BACKGROUND_NAME, Readable.from([bytes]), bytes.length);
    const sources = attachments.listByOwner(owner(initiative.id)).map((a) => a.id);
    const taskId = unit.transact(() => {
      const created = tasks.insertDraft({
        projectId: initiative.projectId,
        workflowId: workflow.id,
        title: item.title,
        requirement: item.requirement,
        baseBranch,
        attachmentIds: [background.id, ...sources],
        ...(item.acceptance.length === 0 ? {} : { requirements: item.acceptance }),
        ...(initiative.confirmItemPlans ? { checkpoints: { confirm_plan: true } } : {}),
      });
      if (!repo.claimItem(item.id, item.taskId, initiative.breakdownRev, created, clock.now())) {
        // Rolls the task back: another start took the work package, the user dropped it or a breakdown rewrote it,
        // meanwhile. Not a failure of the work package: no start error is recorded.
        throw new AppError(ErrorCode.InitiativeItemNotReady, `Work package ${item.key} changed meanwhile`, {
          status: item.dto.status,
        });
      }
      return created;
    });
    log.info({ initiativeId: initiative.id, item: item.key, taskId }, 'initiative work package started');
    tasks.start(taskId);
    publish(initiative.id);
  }

  /**
   * Opens phases marked `autoOpen` whose earlier work is done and starts every work package of an opened phase that
   * never started (34 §6.3, §15.5). Started again after a cancel or a failed start only by the user.
   */
  async function reconcileNow(id: string): Promise<void> {
    let initiative = repo.find(id);
    if (initiative === undefined || initiative.confirmedRev < initiative.breakdownRev || initiative.openedPhase === 0) {
      return;
    }
    let items = views(initiative);
    while (
      statusOf(initiative, items) === InitiativeStatus.PhaseDone &&
      initiative.phases[initiative.openedPhase]?.autoOpen === true &&
      repo.openPhase(id, initiative.openedPhase + 1, clock.now())
    ) {
      log.info({ initiativeId: id, phase: initiative.openedPhase + 1 }, 'initiative phase opened automatically');
      publish(id);
      initiative = get(id);
      items = views(initiative);
    }
    for (const item of items) {
      if (item.dto.status !== InitiativeItemStatus.Ready || item.taskId !== null || item.startError !== null) continue;
      try {
        await startItem(initiative, item, items);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        if (err.code === ErrorCode.InitiativeItemNotReady) continue;
        repo.updateItem(item.id, { startError: err.toInfo(), updatedAt: clock.now() });
        log.warn({ initiativeId: id, item: item.key, code: err.code }, 'initiative work package could not start');
        publish(id);
      }
      // What started changes the background of the next ones only once it is done; the views stay valid.
    }
  }

  /** One reconcile at a time per initiative, each after the previous; callers do not wait unless they need to. */
  const running = new Map<string, Promise<void>>();
  function reconcile(id: string): Promise<void> {
    const previous = running.get(id) ?? Promise.resolve();
    const next = previous
      .then(() => reconcileNow(id))
      .catch((err: unknown) => log.error({ err, initiativeId: id }, 'initiative reconcile failed'));
    running.set(id, next);
    void next.then(() => {
      if (running.get(id) === next) running.delete(id);
    });
    return next;
  }

  // A work package's task changing may satisfy it and so open a phase or start its dependents.
  events.subscribe((event) => {
    if (event.type !== ServerEventType.TaskUpdated) return;
    const id = repo.initiativeOfTask(event.data.id);
    if (id !== undefined) void reconcile(id);
  });
  // Initiatives are deleted with their project; their source attachments' references go with them (34 §9).
  tasks.onProjectDeleted((projectId) => {
    const ids = repo.idsOfProject(projectId);
    for (const id of ids) assertIdle(id);
    attachments.release(AttachmentOwnerKind.Initiative, ids);
    // The runs point at their attempts: the initiatives go first, then the attempts (34 §9).
    const attemptIds = repo.runAttemptIds(ids);
    for (const id of ids) repo.delete(id);
    attempts.delete(attemptIds);
  });

  /** Work that started, finished or was dropped stays exactly as it was, whoever rewrites the draft (34 §5.2, §8.4). */
  function lockedProblems(current: readonly ItemView[], draft: InitiativeDraft): InitiativeProblem[] {
    const problems: InitiativeProblem[] = [];
    const next = new Map(draft.items.map((item) => [item.key, item]));
    const same = (a: InitiativeItemSpec, b: InitiativeItem) =>
      JSON.stringify(itemColumns(a)) === JSON.stringify(itemColumns({ ...b, workflow: b.workflowKey }));
    for (const item of current) {
      if (item.taskId === null && item.droppedAt === null) continue;
      const edited = next.get(item.key);
      if (edited === undefined || !same(edited, item)) {
        problems.push({
          code: InitiativeProblemCode.ItemNotEditable,
          itemKey: item.key,
          message: `${item.key} already started, finished or was dropped and cannot change`,
        });
      }
    }
    return problems;
  }

  /** A user edit (34 §5.2): rules of the draft (the allowed workflows too, as for the AI), and the work already under way kept. */
  function checkEdit(initiative: Initiative, current: readonly ItemView[], draft: InitiativeDraft): void {
    const allowedWorkflows = allowedWorkflowsOf(initiative).map((w) => w.key);
    const problems = [
      ...validateInitiativeDraft(draft, { workflowExists, allowedWorkflows }),
      ...lockedProblems(current, draft),
    ];
    if (problems.length > 0) throw invalid(problems);
    if (draft.phases.length < initiative.openedPhase) {
      throw new AppError(ErrorCode.InitiativeNotEditable, 'An opened phase cannot be removed', {
        status: statusOf(initiative, current),
      });
    }
  }

  /** Replaces the phases and the work packages (callers checked what may change); inside the caller's transaction. */
  function writeDraft(id: string, current: readonly ItemView[], draft: InitiativeDraft, now: number): void {
    repo.update(id, { phases: draft.phases, updatedAt: now });
    const byKey = new Map(current.map((item) => [item.key, item]));
    const kept = new Set(draft.items.map((item) => item.key));
    for (const item of current) if (!kept.has(item.key)) repo.deleteItem(item.id);
    draft.items.forEach((item, ordinal) => {
      const existing = byKey.get(item.key);
      if (existing === undefined) {
        repo.insertItem({
          id: randomUUID(),
          initiativeId: id,
          ordinal,
          ...itemColumns(item),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        repo.updateItem(existing.id, { ordinal, ...itemColumns(item), updatedAt: now });
      }
    });
  }

  /** The workflows the AI may give work packages: the initiative's, else every listed one (34 §5.1). */
  function allowedWorkflowsOf(initiative: Initiative): WorkflowSummaryDTO[] {
    const listed = workflows.list().filter((w) => w.kind !== WorkflowKind.System);
    return initiative.allowedWorkflows === null
      ? listed
      : listed.filter((w) => initiative.allowedWorkflows?.includes(w.key));
  }

  const draftOfItems = (initiative: Initiative, items: readonly ItemView[]): InitiativeDraft => ({
    phases: initiative.phases,
    items: items.map(({ key, title, phase, workflowKey, requirement, dependsOn, acceptance }) => ({
      key,
      title,
      phase,
      workflow: workflowKey,
      requirement,
      dependsOn,
      acceptance,
    })),
  });

  /**
   * Starts one breakdown run (34 §8.1): on the initiative's session when it has one (the reviewer remembers what it
   * read), otherwise a new read-only session in the project's repository whose first message carries the requirement.
   * The attempt row is written before the session can call back, the run row right after it.
   */
  async function startRun(
    initiative: Initiative,
    mode: InitiativeRunMode,
    step: string,
    extra: { instruction: string | null; openPhase: number | null },
  ): Promise<void> {
    attempts.requireReady();
    assertIdle(initiative.id);
    const runs = repo.runs(initiative.id);
    const previous = runs.at(-1);
    const session = previous === undefined ? null : attempts.get(previous.attemptId).opencodeSessionId;
    const planner = roles.getByKey(BuiltinRoleKey.Planner);
    const model = planner.model ?? settings.get('ai.defaultModel');
    const attemptId = randomUUID();
    const project = projects.getRecord(initiative.projectId);
    const first = () =>
      startMessage(prompts, {
        projectName: project.name,
        baseBranch: initiative.baseBranch,
        requirement: initiative.requirement,
        attachments: attachments.promptSection(
          attachments.listByOwner(owner(initiative.id)),
          `${MCP_TOOL_PREFIX}${McpToolName.ReadAttachment}`,
        ),
        workflows: allowedWorkflowsOf(initiative),
      });
    const started =
      previous !== undefined && session !== null
        ? attempts.continueSession(previous.attemptId, {
            id: attemptId,
            kind: AttemptKind.Breakdown,
            prompt: step,
            model,
            agent: SessionAgent.CodeReviewer,
            system: undefined,
          })
        : attempts.start({
            id: attemptId,
            kind: AttemptKind.Breakdown,
            agent: SessionAgent.CodeReviewer,
            taskId: null,
            projectId: initiative.projectId,
            nodeId: null,
            roleId: planner.id,
            directory: project.repoPath,
            title: `${SESSION_TITLE_PREFIX} · ${INITIATIVE_KEY_PREFIX}${initiative.seq}`,
            model,
            prompt: step === '' ? first() : `${first()}\n\n${step}`,
          });
    const now = clock.now();
    unit.transact(() => {
      repo.insertRun({
        id: randomUUID(),
        initiativeId: initiative.id,
        seq: runs.length + 1,
        attemptId,
        mode,
        instruction: extra.instruction,
        openPhase: extra.openPhase,
        createdAt: now,
      });
      repo.update(initiative.id, { updatedAt: now });
    });
    log.info({ initiativeId: initiative.id, mode }, 'initiative breakdown started');
    publish(initiative.id);
    await started;
  }

  /** A refinement (D136): the current draft with what each work package's state is, and what finished. */
  function startRefine(initiative: Initiative, instruction: string | null, openPhase: number | null): Promise<void> {
    const items = views(initiative);
    const state = (item: ItemView): RefineItem['state'] =>
      item.droppedAt !== null
        ? 'dropped'
        : isDone(item.dto.status)
          ? 'done'
          : item.taskId !== null
            ? 'started'
            : 'open';
    const draft = draftOfItems(initiative, items);
    const step = refineStep(prompts, {
      baseBranch: initiative.baseBranch,
      phases: initiative.phases,
      items: draft.items.map((spec, i) => ({ ...spec, state: state(items[i] as ItemView) })),
      done: items.filter((item) => isDone(item.dto.status)).map(doneItem),
      openedPhase: initiative.openedPhase,
      instruction,
    });
    return startRun(initiative, InitiativeRunMode.Refine, step, { instruction, openPhase });
  }

  // A breakdown ending changes what the page shows: a draft, or a failure to retry.
  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.kind !== AttemptKind.Breakdown) return;
    const run = repo.runOfAttempt(attempt.id);
    if (run !== undefined) publish(run.initiativeId);
  });

  function itemOf(initiative: Initiative, key: string): ItemView {
    const item = views(initiative).find((i) => i.key === key);
    if (item === undefined) {
      throw new AppError(ErrorCode.ValidationFailed, `Work package ${key} not found`, {
        issues: [{ path: ['key'], message: `no work package ${key}` }],
      });
    }
    return item;
  }
  const notReady = (item: ItemView) =>
    new AppError(ErrorCode.InitiativeItemNotReady, `Work package ${item.key} is ${item.dto.status}`, {
      status: item.dto.status,
    });

  /** An initiative the AI breaks down (34 §5.1): no phases yet; the first run starts at once. */
  async function createBrokenDown(
    input: ReturnType<typeof createInitiativeRequestSchema.parse>,
  ): Promise<InitiativeDetailDTO> {
    attempts.requireReady();
    const allowed = input.allowedWorkflows ?? null;
    const unknown = (allowed ?? []).filter((key) => !workflowExists(key));
    if (unknown.length > 0) {
      throw invalid(
        unknown.map((key) => ({
          code: InitiativeProblemCode.UnknownWorkflow,
          message: `Workflow ${key} does not exist`,
          details: { workflow: key },
        })),
      );
    }
    const first = workflowOf(allowed?.[0] ?? workflows.list().find((w) => w.kind !== WorkflowKind.System)?.key ?? '');
    if (first === null) throw new AppError(ErrorCode.WorkflowNotFound, 'No workflow to break down into', {});
    const baseBranch = await tasks.checkCreate({
      projectId: input.projectId,
      workflowId: first.id,
      baseBranch: input.baseBranch,
    });
    const id = randomUUID();
    const now = clock.now();
    unit.transact(() => {
      repo.insert({
        id,
        projectId: input.projectId,
        templateId: null,
        baseBranch,
        title: firstLine(input.requirement).slice(0, INITIATIVE_TITLE_MAX_CHARS),
        requirement: input.requirement,
        phases: [],
        confirmItemPlans: input.confirmItemPlans,
        allowedWorkflows: allowed,
        summary: null,
        understanding: null,
        coverage: null,
        breakdownRev: 0,
        confirmedRev: 0,
        openedPhase: 0,
        createdAt: now,
        updatedAt: now,
      });
      if (input.attachmentIds !== undefined) attachments.bind(owner(id), input.attachmentIds);
    });
    log.info({ initiativeId: id }, 'initiative created for breakdown');
    await startRun(get(id), InitiativeRunMode.Breakdown, '', { instruction: null, openPhase: null });
    return detail(id);
  }

  return {
    detail,
    /** Resolves once every reconcile under way has finished (tests, shutdown). */
    async settled(): Promise<void> {
      while (running.size > 0) await Promise.all(running.values());
    },
    /** After a restart: what events were missed while the app was closed (34 §6.3). */
    recover(): void {
      for (const id of repo.confirmedIds()) void reconcile(id);
    },

    templates: {
      syncBuiltin: templates.syncBuiltin,
      list: (): InitiativeTemplateDTO[] => templates.list(),
    },

    list({ projectId, limit, cursor }: ListInitiativesQuery): {
      items: InitiativeSummaryDTO[];
      nextCursor: string | null;
    } {
      const rows = repo.page({
        projectId,
        beforeSeq: cursor === undefined ? undefined : Number(cursor),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((initiative) => summary(initiative, views(initiative))),
        nextCursor: rows.length > limit && last !== undefined ? String(last.seq) : null,
      };
    },

    /**
     * From a composition template (34 §15.4): straight into phase 1, or a draft when the user wants to look first.
     * Without a template, the AI breaks the requirement down into a draft for the user to confirm (34 §5.1, D133).
     */
    async create(request: CreateInitiativeRequest): Promise<InitiativeDetailDTO> {
      const input = createInitiativeRequestSchema.parse(request);
      if (input.templateKey === undefined) return createBrokenDown(input);
      const template = templates.get(input.templateKey);
      const draft: InitiativeDraft = {
        phases: template.phases,
        items: template.items.map((item) => ({
          ...item,
          requirement: renderTemplateRequirement(item.requirement, input.requirement),
        })),
      };
      const tooLong = draft.items.find((item) => item.requirement.length > INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS);
      if (tooLong !== undefined) {
        throw new AppError(ErrorCode.ValidationFailed, 'The requirement is too long for the template', {
          issues: [
            {
              path: ['requirement'],
              message: `${tooLong.key}'s requirement exceeds ${INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS} characters`,
            },
          ],
        });
      }
      const problems = validateInitiativeDraft(draft, { workflowExists });
      if (problems.length > 0) throw invalid(problems);
      const first = workflowOf(draft.items[0]?.workflow ?? '');
      if (first === null) throw invalid(problems);
      const baseBranch = await tasks.checkCreate({
        projectId: input.projectId,
        workflowId: first.id,
        baseBranch: input.baseBranch,
      });
      const id = randomUUID();
      const now = clock.now();
      unit.transact(() => {
        repo.insert({
          id,
          projectId: input.projectId,
          templateId: template.id,
          baseBranch,
          title: firstLine(input.requirement).slice(0, INITIATIVE_TITLE_MAX_CHARS),
          requirement: input.requirement,
          phases: draft.phases,
          confirmItemPlans: input.confirmItemPlans,
          allowedWorkflows: null,
          summary: null,
          understanding: null,
          coverage: null,
          breakdownRev: 1,
          confirmedRev: input.review ? 0 : 1,
          openedPhase: input.review ? 0 : 1,
          createdAt: now,
          updatedAt: now,
        });
        draft.items.forEach((item, ordinal) => {
          repo.insertItem({
            id: randomUUID(),
            initiativeId: id,
            ordinal,
            ...itemColumns(item),
            createdAt: now,
            updatedAt: now,
          });
        });
        if (input.attachmentIds !== undefined) attachments.bind(owner(id), input.attachmentIds);
      });
      log.info({ initiativeId: id, template: template.key, review: input.review }, 'initiative created');
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** Replaces the phases and the work packages that have not started (34 §5.2). */
    async saveDraft(id: string, draft: InitiativeDraft): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      assertIdle(id);
      const current = views(initiative);
      checkEdit(initiative, current, draft);
      unit.transact(() => writeDraft(id, current, draft, clock.now()));
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /**
     * Confirms the draft; the first time, opens phase 1 (34 §5.2). After a refinement asked for by「进入第 k 阶段」,
     * opens that phase once everything before it is done (34 §5.5).
     */
    async confirm(id: string): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      const items = views(initiative);
      const status = statusOf(initiative, items);
      if (status !== InitiativeStatus.DraftReady) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Nothing to confirm', { status });
      }
      const pendingOpen = latestRun(id)?.run.openPhase ?? null;
      const now = clock.now();
      unit.transact(() => {
        repo.update(id, { confirmedRev: initiative.breakdownRev, updatedAt: now });
        if (initiative.openedPhase === 0) repo.openPhase(id, 1, now);
        else if (
          pendingOpen === initiative.openedPhase + 1 &&
          pendingOpen <= initiative.phases.length &&
          items.every((item) => item.phase >= pendingOpen || isDone(item.dto.status))
        ) {
          repo.openPhase(id, pendingOpen, now);
        }
      });
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** 「进入第 k 阶段」(34 §5.5): the next phase, once every work package before it is done. */
    async openPhase(id: string, phase: number, refine = false): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      assertIdle(id);
      const items = views(initiative);
      const status = statusOf(initiative, items);
      if (status === InitiativeStatus.DraftReady) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Confirm the initiative first', { status });
      }
      const pending = items.filter((item) => item.phase < phase && !isDone(item.dto.status)).map((item) => item.key);
      if (phase !== initiative.openedPhase + 1 || phase > initiative.phases.length || pending.length > 0) {
        throw new AppError(ErrorCode.InitiativePhaseNotReady, `Phase ${phase} cannot be opened now`, {
          openedPhase: initiative.openedPhase,
          items: pending,
        });
      }
      if (refine) {
        // The AI rewrites what is left on the merged code first; confirming its draft opens the phase (D136).
        await startRefine(initiative, null, phase);
        return detail(id);
      }
      repo.openPhase(id, phase, clock.now());
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** A new breakdown with the user's feedback, before the draft is confirmed (34 §5.2). */
    async rebreakdown(id: string, instruction: string | undefined): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      const status = statusOf(initiative, views(initiative));
      if (
        initiative.confirmedRev > 0 ||
        (status !== InitiativeStatus.DraftReady && status !== InitiativeStatus.BreakdownFailed)
      ) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Only a draft not confirmed yet can be broken down again', {
          status,
        });
      }
      const draft = draftOfItems(initiative, views(initiative));
      const step =
        draft.items.length === 0
          ? retryStep(prompts, instruction ?? null)
          : rebreakdownStep(prompts, draft, instruction ?? null);
      await startRun(initiative, InitiativeRunMode.Rebreakdown, step, {
        instruction: instruction ?? null,
        openPhase: null,
      });
      return detail(id);
    },

    /** 「细化剩余工作包」(34 §5.5): the work packages not started, rewritten on the merged code. */
    async refine(id: string, instruction: string | undefined): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      const items = views(initiative);
      const status = statusOf(initiative, items);
      if (initiative.confirmedRev === 0 || status === InitiativeStatus.DraftReady || status === InitiativeStatus.Done) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Nothing to refine now', { status });
      }
      await startRefine(initiative, instruction ?? null, null);
      return detail(id);
    },

    /** `submit_breakdown` (34 §8.2): checked like a user edit (34 §8.3), then the draft waits for the user. */
    submitBreakdown(attempt: AttemptDTO, input: SubmitBreakdownInput): void {
      const run = repo.runOfAttempt(attempt.id);
      if (run === undefined) throw new Error(`Breakdown attempt ${attempt.id} has no initiative run`);
      const initiative = get(run.initiativeId);
      const current = views(initiative);
      const kept = new Map(
        current
          .filter((item) => item.taskId !== null || item.droppedAt !== null)
          .map((item) => [item.key, item.acceptance] as const),
      );
      const draft = draftOf(input, initiative.phases, kept);
      const problems = [
        ...validateInitiativeDraft(draft, {
          workflowExists,
          allowedWorkflows: allowedWorkflowsOf(initiative).map((w) => w.key),
          coverage: input.coverage,
        }),
        ...lockedProblems(current, draft),
      ];
      if (draft.phases.length < initiative.openedPhase) {
        problems.push({
          code: InitiativeProblemCode.PhaseOutOfRange,
          message: `The first ${initiative.openedPhase} phases are opened already and must stay`,
        });
      }
      if (problems.length > 0) throw invalid(problems);
      const now = clock.now();
      unit.transact(() => {
        writeDraft(initiative.id, current, draft, now);
        repo.update(initiative.id, {
          summary: input.summary,
          understanding: input.understanding,
          coverage: input.coverage,
          breakdownRev: initiative.breakdownRev + 1,
          // The title the user saw while it was being broken down is the requirement's first line.
          ...(initiative.breakdownRev === 0 ? { title: input.title } : {}),
          updatedAt: now,
        });
        attempts.markSubmitted(attempt.id);
      });
      log.info(
        { initiativeId: initiative.id, mode: run.mode, items: draft.items.length },
        'initiative breakdown submitted',
      );
      publish(initiative.id);
    },

    /** `read_attachment` for a breakdown session: the initiative's own source files only (30 §3.2). */
    readAttachment(attempt: AttemptDTO, attachmentId: string, cursor: number): ReadAttachmentOutput {
      const run = repo.runOfAttempt(attempt.id);
      if (run === undefined) throw new Error(`Breakdown attempt ${attempt.id} has no initiative run`);
      if (!attachments.listByOwner(owner(run.initiativeId)).some((a) => a.id === attachmentId)) {
        throw new AppError(ErrorCode.AttachmentNotFound, `Attachment ${attachmentId} not found`, { id: attachmentId });
      }
      return attachments.read(attachmentId, cursor);
    },

    /** Starts a work package by hand: after a failed start, or again after its task was cancelled (34 §5.4). */
    async startItem(id: string, key: string): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      // A refined draft not confirmed yet may have rewritten this very work package (34 §5.5).
      if (initiative.confirmedRev < initiative.breakdownRev) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Confirm the draft before starting its work packages', {
          status: InitiativeStatus.DraftReady,
        });
      }
      const all = views(initiative);
      const item = all.find((i) => i.key === key) ?? itemOf(initiative, key);
      if (item.dto.status !== InitiativeItemStatus.Ready) throw notReady(item);
      try {
        await startItem(initiative, item, all);
      } catch (err) {
        if (err instanceof AppError && err.code !== ErrorCode.InitiativeItemNotReady) {
          repo.updateItem(item.id, { startError: err.toInfo(), updatedAt: clock.now() });
        }
        throw err;
      }
      return detail(id);
    },

    /** 「已合入」for a work package delivered as a pull request (D134 ③). */
    async confirmMerged(id: string, key: string): Promise<InitiativeDetailDTO> {
      const item = itemOf(get(id), key);
      if (item.dto.status !== InitiativeItemStatus.PrOpen) throw notReady(item);
      repo.updateItem(item.id, { mergeConfirmedAt: clock.now(), updatedAt: clock.now() });
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** 「不做这一项」: dependents stop waiting for it; a running task is cancelled by the user first. */
    async dropItem(id: string, key: string, reason: string): Promise<InitiativeDetailDTO> {
      const item = itemOf(get(id), key);
      const droppable: readonly InitiativeItemStatus[] = [
        InitiativeItemStatus.Ready,
        InitiativeItemStatus.Waiting,
        InitiativeItemStatus.PhaseClosed,
        InitiativeItemStatus.PrOpen,
      ];
      if (!droppable.includes(item.dto.status)) throw notReady(item);
      repo.updateItem(item.id, { droppedAt: clock.now(), dropReason: reason, updatedAt: clock.now() });
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** 「合并本阶段全部待合并的」: as batch delivery (20 §5, D86), over one phase's work packages. */
    async deliverPhase(
      id: string,
      phase: number,
      strategy: LocalMergeStrategy | undefined,
    ): Promise<DeliverInitiativePhaseResponse> {
      const initiative = get(id);
      const used = strategy ?? settings.get('delivery.defaultStrategy');
      const outcomes: DeliverInitiativePhaseResponse['outcomes'] = [];
      for (const item of views(initiative)) {
        const task = item.dto.task;
        if (
          item.phase !== phase ||
          task === null ||
          !isBatchDeliverable({ task, lastDelivery: item.dto.lastDelivery })
        ) {
          continue;
        }
        const result = await tasks.deliverOutcome(task.id, {
          strategy: item.workflow?.deliverable === WorkflowDeliverable.Report ? DeliveryStrategy.ReportOnly : used,
        });
        outcomes.push({ itemKey: item.key, taskId: task.id, taskKey: task.key, ...result });
      }
      log.info({ initiativeId: id, phase, outcomes: outcomes.map((o) => o.outcome) }, 'initiative phase delivered');
      await reconcile(id);
      return { initiative: detail(id), outcomes };
    },

    /** Deletes the initiative; its tasks stay ordinary tasks (34 §5.6). */
    delete(id: string): void {
      get(id);
      assertIdle(id);
      const attemptIds = repo.runAttemptIds([id]);
      unit.transact(() => {
        attachments.release(AttachmentOwnerKind.Initiative, [id]);
        repo.delete(id);
        attempts.delete(attemptIds);
      });
      log.info({ initiativeId: id }, 'initiative deleted');
      publish(id);
    },
  };
}
export type InitiativesService = ReturnType<typeof createInitiativesService>;
