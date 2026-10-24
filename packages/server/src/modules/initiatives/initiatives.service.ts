import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AppError,
  AttachmentOwnerKind,
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
  InitiativeStatus,
  type InitiativeSummaryDTO,
  type InitiativeTemplateDTO,
  initiativeItemStatusOf,
  initiativeStatusOf,
  isBatchDeliverable,
  isInitiativeItemDone,
  type ListInitiativesQuery,
  type LocalMergeStrategy,
  renderTemplateRequirement,
  ServerEventType,
  validateInitiativeDraft,
  WorkflowDeliverable,
  type WorkflowDTO,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttachmentsService } from '../attachments/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { type DoneItem, renderBackground } from './initiatives.background.ts';
import { createInitiativesRepo, type Initiative, type InitiativeItem, itemColumns } from './initiatives.repo.ts';
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
};

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';
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
      const workflow = workflowOf(item.workflowKey);
      const task = item.taskId === null ? null : (summaries.get(item.taskId) ?? null);
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

  function statusOf(initiative: Initiative, items: readonly ItemView[]): InitiativeStatus {
    return initiativeStatusOf({
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
      phases: initiative.phases.map((phase, i) => ({ ...phase, opened: i + 1 <= initiative.openedPhase })),
      items: items.map((item) => item.dto),
      attachments: attachments.listByOwner(owner(id)),
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
      if (!repo.claimItem(item.id, item.taskId, created, clock.now())) {
        // Rolls the task back: another start took the work package meanwhile.
        throw new AppError(ErrorCode.InitiativeItemNotReady, `Work package ${item.key} started meanwhile`, {
          status: InitiativeItemStatus.InTask,
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
    attachments.release(AttachmentOwnerKind.Initiative, repo.idsOfProject(projectId));
  });

  /** A user edit (34 §5.2): rules of the draft, and work that started, finished or was dropped stays as it was. */
  function checkEdit(initiative: Initiative, current: readonly ItemView[], draft: InitiativeDraft): void {
    const problems = validateInitiativeDraft(draft, { workflowExists });
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
    if (problems.length > 0) throw invalid(problems);
    if (draft.phases.length < initiative.openedPhase) {
      throw new AppError(ErrorCode.InitiativeNotEditable, 'An opened phase cannot be removed', {
        status: statusOf(initiative, current),
      });
    }
  }

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

    /** From a composition template (34 §15.4): straight into phase 1, or a draft when the user wants to look first. */
    async create(request: CreateInitiativeRequest): Promise<InitiativeDetailDTO> {
      const input = createInitiativeRequestSchema.parse(request);
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
      const current = views(initiative);
      checkEdit(initiative, current, draft);
      const now = clock.now();
      const byKey = new Map(current.map((item) => [item.key, item]));
      unit.transact(() => {
        repo.update(id, { phases: draft.phases, updatedAt: now });
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
      });
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** Confirms the draft; the first time, opens phase 1 (34 §5.2). */
    async confirm(id: string): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      const status = statusOf(initiative, views(initiative));
      if (status !== InitiativeStatus.DraftReady) {
        throw new AppError(ErrorCode.InitiativeNotEditable, 'Nothing to confirm', { status });
      }
      const now = clock.now();
      unit.transact(() => {
        repo.update(id, { confirmedRev: initiative.breakdownRev, updatedAt: now });
        if (initiative.openedPhase === 0) repo.openPhase(id, 1, now);
      });
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** 「进入第 k 阶段」(34 §5.5): the next phase, once every work package before it is done. */
    async openPhase(id: string, phase: number): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
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
      repo.openPhase(id, phase, clock.now());
      publish(id);
      await reconcile(id);
      return detail(id);
    },

    /** Starts a work package by hand: after a failed start, or again after its task was cancelled (34 §5.4). */
    async startItem(id: string, key: string): Promise<InitiativeDetailDTO> {
      const initiative = get(id);
      const all = views(initiative);
      const item = all.find((i) => i.key === key) ?? itemOf(initiative, key);
      if (item.dto.status !== InitiativeItemStatus.Ready) throw notReady(item);
      try {
        await startItem(initiative, item, all);
      } catch (err) {
        if (err instanceof AppError) repo.updateItem(item.id, { startError: err.toInfo(), updatedAt: clock.now() });
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
      unit.transact(() => {
        attachments.release(AttachmentOwnerKind.Initiative, [id]);
        repo.delete(id);
      });
      log.info({ initiativeId: id }, 'initiative deleted');
      publish(id);
    },
  };
}
export type InitiativesService = ReturnType<typeof createInitiativesService>;
