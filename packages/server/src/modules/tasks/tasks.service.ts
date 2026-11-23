import { mergeTaskText, SystemWorkflowKey } from '@aw/builtin';
import {
  AcceptanceCheckKind,
  AppError,
  type ArtifactRevision,
  type AttemptDTO,
  AttemptKind,
  BatchDeliveryOutcome,
  BROWSER_TEST_WORKFLOW_KEY,
  type BrowserCase,
  browserTestSubmitTool,
  type CreateTaskRequest,
  type DeliverRequest,
  DeliveryStatus,
  ErrorCode,
  type ErrorInfo,
  frontendRoundSchema,
  isArtifactWorkflow,
  isDesignProposalWorkflow,
  isFrontendWorkflow,
  isRepositoryDocumentWorkflow,
  isTaskCodeReview,
  type ListTasksQuery,
  McpToolName,
  type NodeDetailDTO,
  NodeKind,
  type PlanDTO,
  type PlanGraph,
  type PreviewSessions,
  type RequestChangesRequest,
  type RequirementItemInput,
  type ResultNext,
  resolveTaskDisplayGroup,
  ServerEventType,
  type StartAgentsMdTaskRequest,
  type SubmitResultInput,
  TASK_CODE_REVIEW_NODE_KEY,
  TASK_STATUSES,
  type TaskCodeReviewInput,
  type TaskDetailDTO,
  TaskEventEntity,
  TaskStatus,
  type TaskSummaryDTO,
  taskCodeReviewReportSchema,
} from '@aw/shared';
import { eq, or } from 'drizzle-orm';
import type { EventBus } from '../../core/event-bus.ts';
import { latestTaskPayload, listTaskEvents, recordTaskEvent } from '../timeline/index.ts';
import { createBrowserCases } from './browser-cases.service.ts';
import { createTaskActions } from './tasks.actions.ts';
import { createTaskAgentsMd } from './tasks.agents-md.ts';
import { createTaskArtifacts, isArtifactWritingStep } from './tasks.artifacts.ts';
import { createTaskChanges } from './tasks.changes.ts';
import { createTaskChecks } from './tasks.checks.ts';
import { isCodeReviewStep, latestFinishedCodeReview, resolveTaskCodeReview } from './tasks.code-review.ts';
import { createTaskContext } from './tasks.context.ts';
import { createConventionEvidence } from './tasks.conventions.ts';
import { createTaskDelegation } from './tasks.delegation.ts';
import { createTaskDelivery } from './tasks.delivery.ts';
import { createTaskDiffs } from './tasks.diff.ts';
import { createTaskDocuments } from './tasks.documents.ts';
import { frontendVerified } from './tasks.frontend.ts';
import { createTaskLifecycle } from './tasks.lifecycle.ts';
import { readTaskSkills, type StatusMatch } from './tasks.repo.ts';
import { createTaskRequirements } from './tasks.requirements.ts';
import { createTaskResults } from './tasks.result.ts';
import { createTaskReview } from './tasks.review.ts';
import { createTaskState, type TasksServiceDeps } from './tasks.state.ts';
import { testFollowupsTable } from './tasks.table.ts';

/** Tasks (09 §2): lifecycle, the context their attempts read, decisions on their items, and their views. */
export function createTasksService(deps: TasksServiceDeps & { events: EventBus }) {
  const { db, plans, nodes, attempts, inbox, worktrees, workflows } = deps;
  const state = createTaskState(deps);
  const browserCases = createBrowserCases(deps.db, deps.projects);
  const delegation = createTaskDelegation(deps, state);
  // A finished verify step's conclusions are written with it (31 §2.2).
  nodes.onVerified((node, commitSha) => state.verify.record(node, commitSha));
  const lifecycle = createTaskLifecycle(deps, state);
  const results = createTaskResults(deps, state);
  const context = createTaskContext(deps, state);
  const requirements = createTaskRequirements(deps, state);
  const actions = createTaskActions(deps, state, lifecycle);
  const checks = createTaskChecks(deps, state, lifecycle);
  const diffs = createTaskDiffs(deps, state);
  const delivery = createTaskDelivery(deps, state);
  const artifacts = createTaskArtifacts(deps, state);
  const documents = createTaskDocuments(deps, state, artifacts);
  const changes = createTaskChanges(deps, state, artifacts, delivery.current, (taskId) =>
    lifecycle.retry(taskId, { recheck: () => false }),
  );
  const review = createTaskReview(deps, state, changes);
  const agentsMd = createTaskAgentsMd(deps, state, lifecycle);
  const previewConventionEvidence = createConventionEvidence(deps, state, review);

  // A task's summary shows its open attention items, working steps and progress line; keep it current.
  deps.events.subscribe((event) => {
    const taskId =
      event.type === ServerEventType.InboxUpdated
        ? event.data.item.taskId
        : event.type === ServerEventType.NodeUpdated
          ? event.data.taskId
          : event.type === ServerEventType.AttemptUpdated
            ? event.data.taskId
            : null;
    if (taskId !== null) state.publish(taskId);
  });

  const isFrontend = (id: string): boolean => isFrontendWorkflow(workflows.get(state.get(id).workflowId));

  function resultSubmissionFields(workflow: ReturnType<typeof workflows.get>, node: ReturnType<typeof nodes.get>) {
    return {
      artifact: isArtifactWorkflow(workflow) && isArtifactWritingStep(node.key),
      verify: node.kind === NodeKind.Verify,
      review: isTaskCodeReview(workflow) && isCodeReviewStep(node),
    };
  }

  function detail(id: string): TaskDetailDTO {
    const task = state.get(id);
    const workflow = workflows.get(task.workflowId);
    const worktree = worktrees.findByTask(id);
    const plan = task.status === TaskStatus.PlanReview ? plans.draft(id) : plans.confirmed(id);
    const summaries = nodes.summaries(id);
    const browserCaseHandoff = deps.browser.caseHandoffs.get(id);
    const frontend = isFrontendWorkflow(workflow)
      ? {
          verified: frontendVerified(summaries),
          rounds: listTaskEvents(db, id, 0, 'frontend_round').map(({ payload }) => frontendRoundSchema.parse(payload)),
        }
      : undefined;
    const skills = readTaskSkills(db, id);
    const repositoryDocument = isRepositoryDocumentWorkflow(workflow);
    const showArtifact =
      isArtifactWorkflow(workflow) ||
      (repositoryDocument &&
        (artifacts.visibleVersions(id).length > 0 ||
          task.status === TaskStatus.Preparing ||
          task.status === TaskStatus.Running));
    const reviewResult = isTaskCodeReview(workflow)
      ? latestFinishedCodeReview(nodes.listByTask(id))?.result
      : undefined;
    const proposal = isDesignProposalWorkflow(workflow);
    const reportNode =
      proposal || isTaskCodeReview(workflow)
        ? summaries.findLast(
            (n) => n.key === (proposal ? 'design' : TASK_CODE_REVIEW_NODE_KEY) || n.kind === NodeKind.Revise,
          )
        : undefined;
    const author =
      reportNode && !reportNode.resultSummary
        ? attempts.listByNode(reportNode.id).findLast((a) => a.kind === AttemptKind.Execute)
        : undefined;
    const draft = author && latestTaskPayload(db, id, author.id, 'report_draft');
    const links = db
      .select({
        sourceId: testFollowupsTable.sourceId,
        taskId: testFollowupsTable.taskId,
        kind: testFollowupsTable.kind,
        executionIds: testFollowupsTable.executions,
      })
      .from(testFollowupsTable)
      .where(or(eq(testFollowupsTable.sourceId, id), eq(testFollowupsTable.taskId, id)))
      .all();
    return {
      ...state.summary(task),
      ...(links.length ? { testLinks: links } : {}),
      ...(proposal
        ? {
            proposal: {
              text: reportNode?.resultSummary ?? (typeof draft?.proposal === 'string' ? draft.proposal : null),
            },
          }
        : {}),
      ...(showArtifact ? { artifact: artifacts.details(id) } : {}),
      ...(isTaskCodeReview(workflow)
        ? {
            codeReview: {
              ...(draft?.review ? { draft: taskCodeReviewReportSchema.parse(draft.review) } : {}),
              report: reviewResult?.reviewReport ?? null,
              summary: reviewResult?.summary ?? null,
            },
          }
        : {}),
      requirement: task.requirement,
      ...(task.browserCase === null ? {} : { browserCase: task.browserCase }),
      ...(browserCaseHandoff === undefined ? {} : { browserCaseHandoff }),
      ...(task.browserTest === null ? {} : { browserTest: task.browserTest }),
      ...(task.functionalTest === null ? {} : { functionalTest: task.functionalTest }),
      ...(skills.length === 0 ? {} : { skills: skills.map(({ id, name, version }) => ({ id, name, version })) }),
      failedPhase: task.failedPhase,
      failure: task.failure,
      workflow: {
        id: workflow.id,
        key: workflow.key,
        name: workflow.name,
        version: workflow.version,
        planning: workflow.planning,
        deliverable: workflow.deliverable,
      },
      checkpoints: task.checkpoints,
      git: {
        baseBranch: task.baseBranch,
        baseCommit: task.baseCommit,
        branch: task.branch,
        worktreePath: worktree?.path ?? null,
        worktreeStatus: worktree?.status ?? null,
      },
      plan: plan ?? null,
      draftPlan: task.status === TaskStatus.Paused ? (plans.draft(id) ?? null) : null,
      nodes: summaries,
      ...(frontend === undefined ? {} : { frontend }),
      activeAttempts: attempts.listActive(id),
      openInbox: inbox.listOpen({ taskId: id }),
      result:
        task.result === null
          ? null
          : {
              ...task.result,
              checks: task.result.checks.map(({ evidence: _evidence, ...check }) => check),
            },
      lastDelivery: delivery.lastDelivery(id),
      pullRequest: review.pullRequestOf(id),
      attachments: state.attachmentsOf(task),
    };
  }

  async function startBrowserCase(projectId: string, browserCase: BrowserCase, baseBranch?: string) {
    const workflow = workflows.latest(BROWSER_TEST_WORKFLOW_KEY);
    const input = {
      projectId,
      workflowId: workflow.id,
      requirement: browserCase.name,
      title: browserCase.name,
      browserTest: browserCase.scope,
      ...(baseBranch === undefined ? {} : { baseBranch }),
    };
    const branch = await lifecycle.checkCreate(input);
    const id = lifecycle.insertDraft({ ...input, baseBranch: branch, browserCase });
    lifecycle.start(id);
    return detail(id);
  }

  async function deliver(id: string, request: Omit<DeliverRequest, 'id'>): Promise<TaskDetailDTO> {
    if (isFrontend(id) && !frontendVerified(nodes.listByTask(id)))
      throw new AppError(ErrorCode.StateTransitionInvalid, 'Finish frontend verification before delivery');
    const checklist = await requirements.deliveryCheck(id, request.acknowledgedRequirementsRevisionId);
    const reviewedDocuments = await documents.forDelivery(id, request.artifactVersionId);
    await delivery.deliver(id, request, checklist, reviewedDocuments);
    return detail(id);
  }

  return {
    async saveReportDraft(attempt: AttemptDTO, review: TaskCodeReviewInput | undefined, proposal: string | undefined) {
      if (attempt.taskId === null || attempt.nodeId === null || attempt.kind !== AttemptKind.Execute)
        throw new AppError(ErrorCode.McpToolNotAllowed, 'Drafts belong to a report step');
      const task = state.get(attempt.taskId);
      const workflow = workflows.get(task.workflowId);
      const node = nodes.get(attempt.nodeId);
      let payload: Record<string, unknown>;
      if (review && proposal === undefined && resultSubmissionFields(workflow, node).review) {
        payload = { review: await resolveTaskCodeReview(deps.projects.getRecord(task.projectId).repoPath, review) };
      } else if (
        proposal &&
        !review &&
        isDesignProposalWorkflow(workflow) &&
        (node.key === 'design' || node.kind === NodeKind.Revise)
      ) {
        payload = { proposal };
      } else throw new AppError(ErrorCode.McpToolNotAllowed, 'This draft does not belong to the current step');
      recordTaskEvent(db, {
        taskId: task.id,
        entity: TaskEventEntity.Attempt,
        entityId: attempt.id,
        type: 'report_draft',
        payload,
        createdAt: deps.clock.now(),
      });
    },
    resultSubmissionFields(attempt: AttemptDTO) {
      if (attempt.taskId === null || attempt.nodeId === null) return { verify: false, review: false, artifact: false };
      return resultSubmissionFields(workflows.get(state.get(attempt.taskId).workflowId), nodes.get(attempt.nodeId));
    },
    detail,
    async workbenchDetail(id: string): Promise<TaskDetailDTO> {
      await documents.prepare(id);
      return detail(id);
    },
    isFrontend,
    browserCases,
    runBrowserCase: (projectId: string, caseId: string, revision: number) =>
      startBrowserCase(projectId, browserCases.revision(projectId, caseId, revision)),
    rerunBrowserCase(id: string) {
      const task = state.get(id);
      if (task.browserCase === null)
        throw new AppError(ErrorCode.ValidationFailed, 'There is no saved case snapshot in this task');
      return startBrowserCase(task.projectId, task.browserCase, task.baseBranch);
    },
    latestArtifactOf(id: string) {
      const task = state.get(id);
      const workflow = workflows.get(task.workflowId);
      return isArtifactWorkflow(workflow) || isRepositoryDocumentWorkflow(workflow)
        ? artifacts.visibleVersions(id).at(-1)
        : undefined;
    },
    artifacts,
    documentDraft: documents.draft,
    async reviseArtifact(input: ArtifactRevision): Promise<TaskDetailDTO> {
      await documents.prepare(input.id);
      await documents.assertEditableVersion(input);
      changes.reviseArtifact(input);
      return detail(input.id);
    },
    frontendVerified: (id: string) => frontendVerified(nodes.listByTask(id)),
    /** A page of task summaries (11 §5); the display group is decided in SQL so that pages stay full. */
    list({ projectId, status, displayGroup, archived, limit, cursor }: ListTasksQuery): {
      items: TaskSummaryDTO[];
      nextCursor: string | null;
    } {
      const attention = state.attentionTaskIds();
      const statuses = status === undefined ? TASK_STATUSES : [status];
      const oneOf =
        status === undefined && displayGroup === undefined
          ? undefined
          : statuses.flatMap((status) => {
              if (displayGroup === undefined) return [{ status, attention: 'any' } satisfies StatusMatch];
              const variants =
                status === TaskStatus.Review
                  ? ([
                      [false, false],
                      [true, false],
                      [false, true],
                    ] as const)
                  : ([[undefined, undefined]] as const);
              return variants.flatMap(([frontendIteration, artifactIteration]): StatusMatch[] => {
                const without =
                  resolveTaskDisplayGroup(status, false, frontendIteration, artifactIteration) === displayGroup;
                const withAttention =
                  resolveTaskDisplayGroup(status, true, frontendIteration, artifactIteration) === displayGroup;
                if (!without && !withAttention) return [];
                const attention = without && withAttention ? 'any' : without ? 'without' : 'with';
                return [
                  {
                    status,
                    attention,
                    ...(frontendIteration === undefined ? {} : { frontendIteration }),
                    ...(artifactIteration === undefined ? {} : { artifactIteration }),
                  },
                ];
              });
            });
      const [updatedAt, seq] = cursor === undefined ? [] : cursor.split('.').map(Number);
      const rows = state.repo.page({
        projectId,
        archived,
        oneOf,
        attention,
        after: updatedAt === undefined || seq === undefined ? undefined : { updatedAt, seq },
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: state.summaries(page),
        nextCursor: rows.length > limit && last !== undefined ? `${last.updatedAt}.${last.seq}` : null,
      };
    },
    /** Summaries of the given tasks, in the given order (batches 20 §4, quality and usage 19 §4). */
    summariesOf(ids: readonly string[]): TaskSummaryDTO[] {
      const byId = new Map(state.repo.list({ ids }).map((task) => [task.id, task]));
      return state.summaries(
        ids.map((id) => {
          const task = byId.get(id);
          if (task === undefined) throw new AppError(ErrorCode.TaskNotFound, `Task ${id} not found`, { id });
          return task;
        }),
      );
    },
    async refreshDeliveryStatus(id: string) {
      await review.refreshDeliveryStatus(id);
      return detail(id);
    },
    /** The task's current round's latest delivery (`TaskDetailDTO.lastDelivery`). */
    lastDelivery: (id: string) => delivery.current(id),
    /** Tasks in the given states, for the scheduler. */
    listByStatus: (statuses: readonly TaskStatus[]) => state.repo.list({ statuses }),
    /** Every task of a project, for the Git console. */
    listByProject: (projectId: string) => state.repo.list({ projectId }),
    /** What the preview tab can show besides the user's own preview (29 §8.1). */
    previewSessions(id: string): PreviewSessions {
      const task = state.get(id);
      const testTab = task.browserTest === null ? undefined : deps.browser.testTab(id);
      return {
        ...(testTab === undefined ? {} : { testTab }),
        attempts: deps.attempts
          .listByTask(id)
          .map((a) => ({
            attemptId: a.id,
            nodeId: a.nodeId,
            kind: a.kind,
            status: a.status,
            frames: deps.browser.frames(a.id).length,
            ...(task.browserTest === null ? {} : { actions: deps.browser.testActions(a.id).length }),
            screenshots: task.browserTest === null ? [] : deps.browser.screenshots(a.id),
          }))
          .filter(
            (a) =>
              a.frames > 0 || a.screenshots.length > 0 || (a.actions ?? 0) > 0 || a.attemptId === testTab?.attemptId,
          ),
        checks: deps.nodes
          .listByTask(id)
          .flatMap((node) =>
            (node.checkResults ?? []).flatMap((c) =>
              c.kind === AcceptanceCheckKind.Browser && c.pages.length > 0
                ? [{ nodeId: node.id, passed: c.passed }]
                : [],
            ),
          ),
      };
    },

    timeline: (id: string, afterId: number) => {
      state.get(id);
      return listTaskEvents(db, id, afterId);
    },

    async create(input: CreateTaskRequest, onCreated?: (taskId: string) => void): Promise<TaskDetailDTO> {
      const baseBranch = await lifecycle.checkCreate(input);
      const scope = input.functionalTest;
      const choice = scope?.moduleSelection;
      let functionalTest: TaskDetailDTO['functionalTest'] = scope;
      if (scope && choice) {
        if (!scope.target.startsWith('/'))
          throw new AppError(ErrorCode.ValidationFailed, 'Selected modules require a local test target');
        const { module, config, launch, current } = await deps.selectProjectModule(
          input.projectId,
          choice.moduleId,
          choice.configurationId,
          choice.fingerprint,
          baseBranch,
        );
        functionalTest = {
          ...scope,
          moduleSelection: { moduleId: module.id, configurationId: config.id, fingerprint: config.fingerprint },
          moduleLaunch: { baseline: current.baseline, moduleName: module.name, configurationName: config.name, launch },
        };
      }
      // 助手归属与任务同时提交，启动前已可跟进；登记失败时不留下无归属的任务。
      const id = deps.unit.transact(() => {
        const created = lifecycle.insertDraft({ ...input, ...(functionalTest ? { functionalTest } : {}), baseBranch });
        onCreated?.(created);
        return created;
      });
      if (input.start !== false) lifecycle.start(id);
      return detail(id);
    },
    /**
     * The Git workbench's 「交给 AI 解决」 (27 §3.6): a task of the system workflow `merge_branch` whose worktree
     * starts at `source` and merges `target` in; the user merges its result into `target` from the result card.
     */
    createMergeTask({
      projectId,
      source,
      target,
    }: {
      projectId: string;
      source: string;
      target: string;
    }): TaskDetailDTO {
      const workflow = workflows.system(SystemWorkflowKey.MergeBranch);
      const id = lifecycle.insertDraft({
        projectId,
        workflowId: workflow.id,
        ...mergeTaskText(source, target),
        baseBranch: target,
        mergeSource: source,
      });
      lifecycle.start(id);
      return detail(id);
    },
    previewConventionEvidence,
    /** The project page's AGENTS.md and the task that generates or supplements it (40). */
    agentsMd: agentsMd.get,
    async createAgentsMdTask(input: StartAgentsMdTaskRequest): Promise<TaskDetailDTO> {
      return detail(await agentsMd.createTask(input));
    },
    onProjectDeleted: actions.onProjectDeleted,
    /** Creating several tasks in one transaction (batches, 20 §2): check once, insert drafts, start after commit. */
    checkCreate: lifecycle.checkCreate,
    browserTest: (id: string) => state.get(id).browserTest,
    browserTestSubmit: (attempt: AttemptDTO) => {
      if (attempt.taskId === null || state.get(attempt.taskId).browserTest === null) return undefined;
      return attempt.nodeId === null ? McpToolName.SubmitResult : browserTestSubmitTool(nodes.get(attempt.nodeId).kind);
    },
    insertDraft: lifecycle.insertDraft,
    publishUpdate: state.publish,
    start(id: string): TaskDetailDTO {
      lifecycle.start(id);
      return detail(id);
    },
    retry(id: string, feedback?: string): TaskDetailDTO {
      lifecycle.retry(id, { feedback });
      return detail(id);
    },
    async updateCheckCommand(
      id: string,
      command: string,
      updateProject: boolean,
      expectedCommand?: string,
    ): Promise<TaskDetailDTO> {
      await checks.updateCheckCommand(id, command, updateProject, expectedCommand);
      return detail(id);
    },
    skipCheck(id: string): TaskDetailDTO {
      checks.skipCheck(id);
      return detail(id);
    },
    async cancel(id: string, keepBranch: boolean): Promise<TaskDetailDTO> {
      await lifecycle.cancel(id, keepBranch);
      return detail(id);
    },
    /**
     * Delivers one task of a group and says how it ended (batches 20 §5, initiatives 34 §5.4): a conflict or a
     * failed check before merging is that task's outcome, so the caller goes on with the others.
     */
    async deliverOutcome(
      id: string,
      request: Omit<DeliverRequest, 'id'>,
    ): Promise<{ outcome: BatchDeliveryOutcome; error: ErrorInfo | null }> {
      let delivered: TaskDetailDTO;
      try {
        delivered = await deliver(id, request);
      } catch (err) {
        // A check before merging failed and nothing changed (11 §5.3): the task stays in review with the reason.
        if (!(err instanceof AppError)) throw err;
        return { outcome: BatchDeliveryOutcome.Failed, error: err.toInfo() };
      }
      if (delivered.status === TaskStatus.Completed) return { outcome: BatchDeliveryOutcome.Delivered, error: null };
      const { lastDelivery } = delivered;
      if (lastDelivery === null) throw new Error(`Task ${delivered.key} was delivered without a delivery record`);
      const outcome =
        lastDelivery.status === DeliveryStatus.Conflict ? BatchDeliveryOutcome.Conflict : BatchDeliveryOutcome.Failed;
      return { outcome, error: lastDelivery.error };
    },
    deliver,
    async reverifyRequirements(
      id: string,
      revisionId?: string,
      expectedCommitSha?: string,
      items?: readonly RequirementItemInput[],
    ): Promise<TaskDetailDTO> {
      await changes.reverifyRequirements(id, revisionId, expectedCommitSha, items);
      return detail(id);
    },
    async requestChanges(
      id: string,
      reason: RequestChangesRequest['reason'],
      feedback: string | undefined,
      attachmentIds?: readonly string[],
      page?: RequestChangesRequest['page'],
    ): Promise<TaskDetailDTO> {
      await changes.requestChanges(id, reason, feedback, attachmentIds, page);
      return detail(id);
    },
    async finishFrontend(id: string, path?: string): Promise<TaskDetailDTO> {
      await changes.finishFrontend(id, path);
      return detail(id);
    },
    reviewComments: review.reviewComments,
    async reviseFromReview(
      id: string,
      commentIds: readonly string[],
      note: string | undefined,
    ): Promise<TaskDetailDTO> {
      await review.reviseFromReview(id, commentIds, note);
      return detail(id);
    },
    confirmPlan(id: string, version: number): TaskDetailDTO {
      lifecycle.confirmPlan(id, version);
      return detail(id);
    },
    replan(id: string, feedback: string): TaskDetailDTO {
      lifecycle.replan(id, feedback);
      return detail(id);
    },
    saveDraftPlan: (id: string, baseVersion: number, graph: PlanGraph): PlanDTO =>
      lifecycle.saveDraft(id, baseVersion, graph),
    pause(id: string): TaskDetailDTO {
      lifecycle.pause(id);
      return detail(id);
    },
    resume(id: string): TaskDetailDTO {
      lifecycle.resume(id);
      return detail(id);
    },

    node: (taskId: string, nodeId: string): NodeDetailDTO => nodes.detail(taskId, nodeId),
    async acceptNode(taskId: string, nodeId: string): Promise<NodeDetailDTO> {
      await actions.acceptNode(taskId, nodeId);
      return nodes.detail(taskId, nodeId);
    },
    rejectNode(taskId: string, nodeId: string, feedback: string): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      nodes.reject(nodeId, feedback);
      return nodes.detail(taskId, nodeId);
    },
    skipNode(taskId: string, nodeId: string): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      if (state.get(taskId).functionalTest !== null)
        throw new AppError(ErrorCode.NodeNotEditable, 'Functional testing stages must finish in order');
      nodes.skip(nodeId);
      return nodes.detail(taskId, nodeId);
    },
    retryNode(taskId: string, nodeId: string, feedback: string | undefined): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      nodes.retry(nodeId, feedback);
      return nodes.detail(taskId, nodeId);
    },

    /** `submit_result` of a task's execute attempt (12 §6.5). */
    async submitResult(attempt: AttemptDTO, input: SubmitResultInput): Promise<ResultNext> {
      if (attempt.taskId === null || attempt.nodeId === null) throw new Error(`Attempt ${attempt.id} is no step's`);
      if (deps.browser.caseHandoffs.get(attempt.taskId) !== undefined)
        throw new AppError(ErrorCode.BrowserLoginRequired, 'Wait for the user to finish verification in the test tab');
      const task = state.get(attempt.taskId);
      const workflow = workflows.get(task.workflowId);
      const node = nodes.get(attempt.nodeId);
      if (isArtifactWorkflow(workflow)) artifacts.assertPublished(attempt);
      state.verify.checkResults(attempt.taskId, node, input.requirement_results);
      const { code_review, ...result } = input;
      // Older confirmed plans still submit a plain-text summary.
      if (code_review === undefined) return nodes.submitResult(attempt, result, state.runContext(task));
      if (!resultSubmissionFields(workflow, node).review)
        throw new AppError(ErrorCode.McpToolNotAllowed, 'Structured findings are for the code review step');
      const report = await resolveTaskCodeReview(deps.projects.getRecord(task.projectId).repoPath, code_review);
      return nodes.submitResult(attempt, { ...result, reviewReport: report }, state.runContext(task));
    },

    checkEvidence(id: string, evidenceId: string) {
      const check = state.get(id).result?.checks.find((item) => item.evidenceId === evidenceId);
      if (check?.evidence === undefined) throw new AppError(ErrorCode.NotFound, 'Check evidence is unavailable');
      return check.evidence;
    },
    ...diffs,
    resolveInbox: actions.resolveInbox,
    archive(id: string): TaskDetailDTO {
      actions.archive(id);
      return detail(id);
    },
    unarchive(id: string): TaskDetailDTO {
      actions.unarchive(id);
      return detail(id);
    },
    archiveFinished: actions.archiveFinished,
    delete: actions.deleteTask,
    guardDeletion: actions.guardDeletion,
    deleteProject: actions.deleteProject,
    deleteWorkflow: actions.deleteWorkflow,
    deleteRole: actions.deleteRole,
    ...delegation,
    ...context,
    ...requirements,
    submitPlan: lifecycle.submitPlan,
    startPlanning: lifecycle.startPlanning,
    finishRunning: results.finishRunning,
    failRunning: results.failRunning,
    runContext: (taskId: string) => state.runContext(state.get(taskId)),
    /** Startup: deliveries cut short go back to review, preparations continue (03 §2.1). */
    recover(): void {
      delivery.recover();
      lifecycle.recover();
    },
  };
}
export type TasksService = ReturnType<typeof createTasksService>;
