import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AppError,
  type AttemptDTO,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  type FunctionalTestCase,
  type FunctionalTestEvent,
  type FunctionalTestExecution,
  type FunctionalTestLaunch,
  type FunctionalTestPrepare,
  type FunctionalTestProbe,
  type FunctionalTestRead,
  type FunctionalTestRun,
  type FunctionalTestSnapshot,
  FunctionalTestStatus,
  type functionalTestCaseSaveSchema,
  type functionalTestReportSubmitSchema,
  type functionalTestRunInputSchema,
  functionalTestTools,
  isFunctionalTestNode,
  PreviewState,
  ServerEventType,
  type TaskDetailDTO,
  TaskStatus,
} from '@aw/shared';
import type { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { BrowserService } from '../browser/index.ts';
import { runGit } from '../git/index.ts';
import type { PreviewsService } from '../previews/index.ts';
import { executeCase } from './functional-tests.execute.ts';
import { redactText, scopedRequest } from './functional-tests.http.ts';
import { readIdeaConfigurations } from './functional-tests.idea.ts';
import { createFunctionalTestRepo } from './functional-tests.repo.ts';
import { latestCases, makeReport } from './functional-tests.reports.ts';
import { functionalTestRevisions } from './functional-tests.revisions.ts';

type Deps = {
  db: Db;
  projectDirectory: (projectId: string) => string;
  rerunOrigin: (taskId: string) => { taskId: string; executionIds: string[] } | undefined;
  unit: UnitOfWork;
  clock: Clock;
  events: EventBus;
  log: Logger;
  task: (id: string) => TaskDetailDTO;
  attempts: AttemptsService;
  browser: BrowserService;
  previews: PreviewsService;
  filesDirOf: (attempt: AttemptDTO) => string;
};
type Phase = (typeof FUNCTIONAL_TEST_NODE)[keyof typeof FUNCTIONAL_TEST_NODE];
type PreviewLaunchDetails = NonNullable<ReturnType<PreviewsService['launchDetails']>>;

function find<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new AppError(ErrorCode.NotFound, message);
  return value;
}

function launchDetail(launch?: FunctionalTestLaunch) {
  if (launch === undefined) return {};
  const { directory, source, script, readyPath, profile, mainClass, javaVersion, includeProvided } = launch;
  return {
    launch: {
      directory,
      source,
      script,
      readyPath,
      ...(profile === undefined ? {} : { profile }),
      ...(mainClass === undefined ? {} : { mainClass }),
      ...(javaVersion === undefined ? {} : { javaVersion }),
      ...(includeProvided === undefined ? {} : { includeProvided }),
    },
  };
}

export function createFunctionalTests({
  db,
  projectDirectory,
  rerunOrigin,
  unit,
  clock,
  events,
  log,
  task,
  attempts,
  browser,
  previews,
  filesDirOf,
}: Deps) {
  const repo = createFunctionalTestRepo(db, clock, unit);
  const active = new Map<string, { attemptId: string; controller: AbortController; pending: Promise<unknown> }>();
  const ownedPreviews = new Set<string>();
  const previewLeases = new Map<string, PreviewLaunchDetails>();

  function context(id: string) {
    const record = task(id);
    const scope = find(record.functionalTest, 'This task does not have a functional test scope');
    return { record, scope };
  }
  function phase(attempt: AttemptDTO) {
    if (attempt.taskId === null) return undefined;
    const value = task(attempt.taskId);
    return value.functionalTest === undefined || attempt.nodeId === null
      ? undefined
      : value.nodes.find(({ id }) => id === attempt.nodeId)?.key;
  }
  function resolve(attempt: AttemptDTO, phases: readonly Phase[]) {
    if (attempt.taskId === null || !phases.some((value) => value === phase(attempt)))
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This functional tool is not available in the current step');
    return { ...context(attempt.taskId), taskId: attempt.taskId };
  }
  const runOf = (snapshot: FunctionalTestSnapshot, id: string) =>
    find(
      snapshot.runs.find((run) => run.id === id),
      'Functional test run not found',
    );
  const caseOf = (snapshot: FunctionalTestSnapshot, id: string, version: number) =>
    find(
      snapshot.cases.find((value) => value.id === id && value.version === version),
      'Functional test case version not found',
    );
  function emit(taskId: string, event: Parameters<typeof repo.event>[1]) {
    repo.update(taskId, (snapshot) => repo.event(snapshot, event));
  }

  const localReady = (taskId: string) => {
    const lease = previewLeases.get(taskId);
    return (
      lease !== undefined &&
      lease === previews.launchDetails(taskId) &&
      previews.get(taskId).state === PreviewState.Running
    );
  };
  async function release(taskId: string) {
    const lease = previewLeases.get(taskId);
    if (previewLeases.delete(taskId)) previews.release(taskId);
    if (ownedPreviews.delete(taskId) && (lease === undefined || lease === previews.launchDetails(taskId)))
      await previews.stop(taskId);
  }
  async function stop(taskId: string) {
    const work = active.get(taskId);
    work?.controller.abort();
    await release(taskId);
    await work?.pending;
  }
  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.taskId === null) return;
    const work = active.get(attempt.taskId);
    if (work?.attemptId === attempt.id) work.controller.abort();
  });
  events.subscribe((event) => {
    if (event.type !== ServerEventType.TaskUpdated) return;
    const { id, status } = event.data;
    if (status !== TaskStatus.Cancelled && status !== TaskStatus.Failed) return;
    if (active.has(id) || previewLeases.has(id) || ownedPreviews.has(id))
      void stop(id).catch((err: unknown) => log.error({ err, taskId: id }, 'functional test cleanup failed'));
  });

  function perform<T>(
    taskId: string,
    attempt: AttemptDTO,
    request: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (active.has(taskId)) throw new AppError(ErrorCode.StateTransitionInvalid, 'A test action is already running');
    const controller = new AbortController();
    const signal = request === undefined ? controller.signal : AbortSignal.any([request, controller.signal]);
    const pending = work(signal);
    active.set(taskId, { controller, pending, attemptId: attempt.id });
    return pending.finally(() => active.delete(taskId));
  }

  function save(attempt: AttemptDTO, input: z.output<typeof functionalTestCaseSaveSchema>): FunctionalTestCase {
    const { taskId, scope } = resolve(attempt, [FUNCTIONAL_TEST_NODE.Author, FUNCTIONAL_TEST_NODE.Import]);
    if (phase(attempt) === FUNCTIONAL_TEST_NODE.Import && input.source === undefined)
      throw new AppError(ErrorCode.ValidationFailed, 'Imported cases must name their source attachment and location');
    if (input.source !== undefined && !scope.caseAttachmentIds.includes(input.source.attachmentId))
      throw new AppError(ErrorCode.ValidationFailed, 'Choose a user-selected case attachment for this source');
    if (input.steps.length === 0 && input.needsClarification === undefined)
      throw new AppError(ErrorCode.ValidationFailed, 'Supply an executable step or explain the missing expectation');
    return repo.update(taskId, (snapshot) => {
      const latest = latestCases(snapshot);
      const source = input.source;
      const previous =
        input.id !== undefined
          ? find(
              latest.find(({ id }) => id === input.id),
              'Case draft not found',
            )
          : source === undefined
            ? undefined
            : latest.find(
                (item) =>
                  item.source?.attachmentId === source.attachmentId &&
                  item.source.location === source.location &&
                  item.source.originalId === source.originalId,
              );
      if (previous !== undefined && snapshot.executions.some(({ caseId }) => caseId === previous.id))
        throw new AppError(
          ErrorCode.StateTransitionInvalid,
          'An executed case version is immutable; propose a revision',
        );
      const definition = {
        ...input,
        id: previous?.id ?? randomUUID(),
        version: previous?.version ?? 1,
        number: previous?.number ?? `FT-${String(latest.length + 1).padStart(2, '0')}`,
      };
      const position = snapshot.cases.findIndex(({ id }) => id === definition.id);
      if (position === -1) snapshot.cases.push(definition);
      else snapshot.cases[position] = definition;
      repo.event(snapshot, {
        caseId: definition.id,
        kind: 'case',
        message: '已保存功能测试用例',
        detail: { version: definition.version, title: redactText(definition.title), author: attempt.id },
      });
      return definition;
    });
  }

  function readinessChecksFor(taskId: string, executionIds: string[]): FunctionalTestProbe[] {
    const snapshot = repo.get(taskId);
    const selected = new Map<string, FunctionalTestProbe>();
    for (const id of executionIds) {
      const execution = find(
        snapshot.executions.find((item) => item.id === id),
        'Functional test execution not found',
      );
      const test = caseOf(snapshot, execution.caseId, execution.version);
      for (const { key, path, expectedStatus } of runOf(snapshot, execution.runId).environment.checks) {
        if (!test.requires.includes(key)) continue;
        const first = selected.get(key);
        if (first !== undefined && (first.path !== path || first.expectedStatus !== expectedStatus))
          throw new AppError(
            ErrorCode.ValidationFailed,
            'Selected cases have conflicting readiness check definitions',
            { key },
          );
        selected.set(key, { key, path, expectedStatus });
      }
    }
    return [...selected.values()];
  }

  function inheritedChecksFor(taskId: string, snapshot: FunctionalTestSnapshot): FunctionalTestProbe[] {
    if (snapshot.inheritedChecks !== undefined) return snapshot.inheritedChecks;
    if (snapshot.executions.length > 0 || snapshot.reports.length > 0) return [];
    const source = rerunOrigin(taskId);
    if (source === undefined) return [];
    const checks = readinessChecksFor(source.taskId, source.executionIds);
    repo.update(taskId, (current) => {
      current.inheritedChecks = checks;
    });
    return checks;
  }

  /** null means the selected executions used different launchers and need an explicit choice. */
  function inheritedLaunchFor(taskId: string): FunctionalTestLaunch | null | undefined {
    const origin = rerunOrigin(taskId);
    if (origin === undefined || !context(origin.taskId).scope.target.startsWith('/')) return undefined;
    const source = repo.get(origin.taskId);
    const selected = new Set(origin.executionIds);
    const runIds = new Set(source.executions.filter(({ id }) => selected.has(id)).map(({ runId }) => runId));
    let chosen: FunctionalTestLaunch | undefined;
    for (const run of source.runs) {
      const launch = run.environment.launch;
      if (!runIds.has(run.id) || launch === undefined) continue;
      if (chosen !== undefined && !isDeepStrictEqual(chosen, launch)) return null;
      chosen = launch;
    }
    return chosen;
  }

  function prepare(
    attempt: AttemptDTO,
    { checks, launch: requestedLaunch }: FunctionalTestPrepare,
    request: AbortSignal | undefined,
  ): Promise<FunctionalTestRun> {
    const { taskId, scope, record } = resolve(attempt, [
      FUNCTIONAL_TEST_NODE.Environment,
      FUNCTIONAL_TEST_NODE.Execute,
    ]);
    const local = scope.target.startsWith('/');
    if (!local && requestedLaunch !== undefined)
      throw new AppError(ErrorCode.ValidationFailed, 'A launch configuration is only allowed for a local test');
    if (checks !== undefined && new Set(checks.map(({ key }) => key)).size !== checks.length)
      throw new AppError(ErrorCode.ValidationFailed, 'Readiness check keys must be unique');
    return perform(taskId, attempt, request, async (signal) => {
      const snapshot = repo.get(taskId);
      const previous = snapshot.runs.at(-1);
      const hasEvidence = snapshot.executions.length > 0 || snapshot.reports.length > 0;
      const previousLaunch = previous?.environment.launch;
      const inheritedLaunch =
        local && (previousLaunch === undefined || requestedLaunch !== undefined)
          ? inheritedLaunchFor(taskId)
          : undefined;
      const launch = requestedLaunch ?? previousLaunch ?? inheritedLaunch ?? undefined;
      const inherited = inheritedChecksFor(taskId, snapshot);
      const previousChecks = previous?.environment.checks ?? [];
      const definitions = new Map<string, FunctionalTestProbe>(previousChecks.map((check) => [check.key, check]));
      for (const check of checks ?? []) definitions.set(check.key, check);
      for (const check of inherited) definitions.set(check.key, check);
      const checksChanged =
        definitions.size !== previousChecks.length ||
        previousChecks.some(({ key, path, expectedStatus }) => {
          const current = definitions.get(key);
          return current?.path !== path || current?.expectedStatus !== expectedStatus;
        });
      const reusable = previous?.environment.ready && !checksChanged && (!local || localReady(taskId));
      if (reusable && isDeepStrictEqual(previousLaunch, launch)) return previous;

      const id = previous?.id ?? randomUUID();
      const baseline = record.git.baseCommit;
      const launchFields = launchDetail(launch);
      let effectiveLaunch = launchDetail(previousLaunch);
      const probes: FunctionalTestRun['environment']['checks'] = [];
      let target = scope.target;
      let logTail = '';
      let reason: string | null = null;
      let verified = false;
      let startAttempted = false;
      let launchEvidence: Awaited<ReturnType<PreviewsService['resolveTestLaunch']>> | undefined;
      let runtimeDetails: PreviewLaunchDetails | undefined;
      let readyUrl: string | undefined;
      let readyStatus: number | undefined;
      try {
        if (launch === undefined && inheritedLaunch === null)
          throw new AppError(
            ErrorCode.ValidationFailed,
            'Selected runs used different launch configurations; choose one for this retest',
          );
        if (local) {
          const path = find(record.git.worktreePath ?? undefined, 'Test worktree is unavailable');
          const head = (await runGit(['rev-parse', 'HEAD'], { cwd: path })).stdout.trim();
          if (baseline !== head)
            throw new AppError(
              ErrorCode.StateTransitionInvalid,
              'The test worktree differs from the selected baseline',
            );
          if (launch !== undefined) launchEvidence = await previews.resolveTestLaunch(taskId, launch);
          effectiveLaunch = launchDetail(launchEvidence);
        }
        const launchChanged = previous !== undefined && !isDeepStrictEqual(previousLaunch, effectiveLaunch.launch);
        if (launchChanged && hasEvidence)
          throw new AppError(
            ErrorCode.StateTransitionInvalid,
            'The launch cannot change after test evidence has been recorded',
          );
        if (reusable && !launchChanged) return previous;
        signal.throwIfAborted();
        const changedInheritedLaunch =
          inheritedLaunch != null &&
          requestedLaunch !== undefined &&
          !isDeepStrictEqual(inheritedLaunch, effectiveLaunch.launch);
        emit(taskId, {
          runId: id,
          kind: 'environment',
          message: !local
            ? '连接已授权的测试入口'
            : launch === undefined
              ? '启动项目配置的测试服务'
              : changedInheritedLaunch
                ? '复测使用修复版本上明确选择的启动配置'
                : inheritedLaunch != null && previousLaunch === undefined
                  ? '按来源配置启动并重新核实复测环境'
                  : '按本任务的启动配置准备测试服务',
          detail: {
            ...effectiveLaunch,
            ...(changedInheritedLaunch
              ? {
                  originalLaunch: launchDetail(inheritedLaunch).launch ?? null,
                  baseline,
                }
              : {}),
          },
        });
        if (local) {
          if (launchChanged && localReady(taskId)) {
            if (!ownedPreviews.has(taskId) || previews.leaseCount(taskId) > 1)
              throw new AppError(
                ErrorCode.StateTransitionInvalid,
                'The active preview is shared and cannot be replaced',
              );
            await release(taskId);
          }
          signal.throwIfAborted();
          if (previewLeases.has(taskId) && !localReady(taskId)) await release(taskId);
          const state = previews.get(taskId).state;
          if (state !== PreviewState.Running && state !== PreviewState.Starting) ownedPreviews.add(taskId);
          startAttempted = true;
          const preview = await previews.start(taskId, {
            queue: signal,
            filterLog: redactText,
            ...(launch === undefined ? {} : { launch }),
          });
          runtimeDetails = find(previews.launchDetails(taskId), 'Preview has no launch details');
          signal.throwIfAborted();
          if (!previewLeases.has(taskId)) {
            previews.acquire(taskId);
            previewLeases.set(taskId, runtimeDetails);
          }
          target = new URL(scope.target, find(preview.url ?? undefined, 'Preview has no URL')).href;
          logTail = redactText(preview.logTail);
          verified = true;
        }
        const url = new URL(target);
        // The launcher itself verifies a task-specific readiness endpoint. The business URL can intentionally return 404.
        if (launch !== undefined) {
          readyUrl = find(runtimeDetails?.readyUrl, 'Preview has no readiness address');
          readyStatus = find(runtimeDetails?.readyStatus, 'Preview has no readiness observation');
        } else {
          readyUrl = url.href;
          const probe = await scopedRequest(url, { method: 'GET', signal }, { origin: url.origin, writes: [] });
          readyStatus = probe.status;
          await probe.body?.cancel();
          if (!probe.ok && probe.status !== 401 && probe.status !== 403)
            reason = `测试环境就绪检查返回 HTTP ${probe.status}`;
        }
        for (const check of definitions.values()) {
          signal.throwIfAborted();
          let status: number | null = null;
          let problem: string | null = null;
          const address = new URL(check.path, url.origin);
          try {
            const response = await scopedRequest(
              address,
              { method: 'GET', signal },
              { origin: url.origin, writes: [] },
            );
            status = response.status;
            await response.body?.cancel();
            if (status !== check.expectedStatus) problem = `HTTP ${status}，预期 ${check.expectedStatus}`;
          } catch (error) {
            if (!(error instanceof AppError || error instanceof TypeError || error instanceof DOMException))
              throw error;
            problem = redactText(error.message);
          }
          const result = { ...check, path: address.pathname, status, ready: problem === null, reason: problem };
          probes.push(result);
          emit(taskId, { runId: id, kind: 'environment', message: `环境条件：${check.key}`, detail: result });
        }
      } catch (error) {
        if (!(error instanceof AppError || error instanceof TypeError || error instanceof DOMException)) throw error;
        reason = redactText(error.message);
        if (local && startAttempted) {
          const attempted = previews.launchDetails(taskId);
          if (attempted !== undefined && isDeepStrictEqual(attempted.evidence, launchEvidence)) {
            runtimeDetails ??= attempted;
            readyStatus ??= attempted.readyStatus;
            logTail = redactText(previews.get(taskId).logTail);
          }
        }
        if (local && !startAttempted && (previous?.environment.ready || hasEvidence)) {
          // A rejected proposal on a prepared run is evidence about that proposal, not the existing service.
          emit(taskId, {
            runId: id,
            kind: 'environment',
            message: reason,
            detail: { reason, ...launchFields },
          });
          throw error;
        }
      }
      const observedUrl = readyUrl ?? runtimeDetails?.readyUrl;
      // A proposal rejected during validation remains in the activity log, leaving recovery on its last accepted launcher.
      const persistedLaunch = startAttempted ? effectiveLaunch : launchDetail(previousLaunch);
      const run = {
        id,
        createdAt: previous?.createdAt ?? clock.now(),
        environment: {
          id,
          target: redactText(target.split(/[?#]/, 1)[0] ?? target),
          baseline,
          verified,
          ready: reason === null,
          reason,
          logTail,
          checks: probes,
          ...persistedLaunch,
          ...(runtimeDetails === undefined ? {} : { command: redactText(runtimeDetails.command) }),
          ...(observedUrl === undefined
            ? {}
            : { readyUrl: redactText(observedUrl.split(/[?#]/, 1)[0] ?? observedUrl) }),
          ...(readyStatus === undefined ? {} : { readyStatus }),
        },
      };
      repo.update(taskId, (snapshot) => {
        const index = snapshot.runs.findIndex((item) => item.id === run.id);
        if (index === -1) snapshot.runs.push(run);
        else snapshot.runs[index] = run;
        repo.event(snapshot, {
          runId: id,
          kind: 'environment',
          message: reason ?? '测试环境已就绪',
          detail: { ...run.environment, ...(!startAttempted ? launchFields : {}) },
        });
      });
      if (reason !== null) await release(taskId);
      return run;
    });
  }

  function execute(
    attempt: AttemptDTO,
    input: z.output<typeof functionalTestRunInputSchema>,
    request?: AbortSignal,
  ): Promise<FunctionalTestExecution> {
    const { taskId, record, scope } = resolve(attempt, [FUNCTIONAL_TEST_NODE.Execute]);
    const initial = repo.get(taskId);
    const existing = initial.executions.find(({ id }) => id === input.executionId);
    if (existing !== undefined) {
      if (existing.runId !== input.runId || existing.caseId !== input.caseId || existing.version !== input.version)
        throw new AppError(ErrorCode.ValidationFailed, 'This execution ID already identifies different inputs');
      return Promise.resolve(existing);
    }
    if (
      initial.events.some(
        (event) => event.runId === input.runId && event.caseId === input.caseId && event.detail.unknownWrite === true,
      )
    )
      throw new AppError(
        ErrorCode.StateTransitionInvalid,
        'A prior write may already have committed; verify the recorded state before starting a new run',
      );
    return perform(taskId, attempt, request, async (signal) => {
      const run = runOf(initial, input.runId);
      const definition = caseOf(initial, input.caseId, input.version);
      if (latestCases(initial).some(({ id, version }) => id === input.caseId && version !== input.version))
        throw new AppError(ErrorCode.ValidationFailed, 'Read the latest case version before execution');
      if (initial.reports.some(({ runId }) => runId === input.runId))
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The run has already published a report');
      const base = { runId: run.id, caseId: definition.id, executionId: input.executionId };
      const note = (
        step: number | null,
        kind: FunctionalTestEvent['kind'],
        message: string,
        detail: FunctionalTestEvent['detail'],
      ) => emit(taskId, { ...base, step, kind, message, detail });
      const execution = {
        id: base.executionId,
        runId: base.runId,
        caseId: base.caseId,
        version: definition.version,
        startedAt: clock.now(),
        finishedAt: null,
        status: FunctionalTestStatus.Running,
      };
      repo.update(taskId, (snapshot) => {
        snapshot.executions.push(execution);
        repo.event(snapshot, {
          ...base,
          kind: 'execution',
          message: '开始执行功能用例',
          detail: { status: execution.status },
        });
      });
      let status: FunctionalTestStatus = FunctionalTestStatus.Blocked;
      try {
        const missingCondition = definition.requires.find(
          (key) => !run.environment.checks.some((check) => check.key === key && check.ready),
        );
        const issue =
          definition.needsClarification ??
          run.environment.reason ??
          (missingCondition === undefined ? null : `未核实的用例依赖条件：${missingCondition}`);
        if (issue !== null) note(null, 'result', redactText(issue), { status });
        else if (scope.target.startsWith('/') && !localReady(taskId))
          note(null, 'result', '本地服务已停止，请先恢复环境', { status });
        else {
          const target = scope.target.startsWith('/')
            ? new URL(scope.target, find(previews.get(taskId).url ?? undefined, 'Local test service stopped')).href
            : scope.target;
          status = await executeCase({
            definition,
            browser,
            signal,
            target,
            writes: scope.writes,
            emit: note,
            time: clock.now,
            owner: {
              id: attempt.id,
              taskId,
              projectId: record.project.id,
              filesDir: filesDirOf(attempt),
              browserTest: { target, writes: scope.writes },
              savedCase: true,
            },
            logTail: scope.target.startsWith('/') ? previews.logSince(taskId) : () => '',
            waitForUser: (wait) => attempts.waitForBrowserInput(attempt.id, wait),
          });
        }
      } finally {
        const finished = { ...execution, finishedAt: clock.now(), status };
        repo.update(taskId, (snapshot) => {
          const index = snapshot.executions.findIndex(({ id }) => id === execution.id);
          snapshot.executions[index] = finished;
          repo.event(snapshot, { ...base, kind: 'execution', message: '已记录执行结论', detail: { status } });
        });
      }
      return find(
        repo.get(taskId).executions.find(({ id }) => id === execution.id),
        'Execution unavailable',
      );
    });
  }

  function read(taskId: string, input: FunctionalTestRead = {}) {
    context(taskId);
    const snapshot = repo.get(taskId);
    const { runId, caseId, step, after = 0 } = input;
    const matches = (item: { runId: string | null; caseId: string | null }) =>
      (runId === undefined || item.runId === runId) && (caseId === undefined || item.caseId === caseId);
    return {
      ...snapshot,
      cases: snapshot.cases.filter(({ id }) => caseId === undefined || id === caseId),
      runs: snapshot.runs.filter(({ id }) => runId === undefined || id === runId),
      executions: snapshot.executions.filter(matches),
      events: snapshot.events.filter(
        (event) => matches(event) && event.seq > after && (step === undefined || event.step === step),
      ),
      reports: snapshot.reports.filter((item) => runId === undefined || item.runId === runId),
    };
  }

  const revisions = functionalTestRevisions({ repo, resolve, context });
  return {
    phase,
    async ideConfigurations(attempt: AttemptDTO) {
      const { record, scope } = resolve(attempt, [FUNCTIONAL_TEST_NODE.Environment]);
      if (!scope.target.startsWith('/')) throw new AppError(ErrorCode.McpToolNotAllowed, 'Local test target required');
      return readIdeaConfigurations(
        find(record.git.worktreePath ?? undefined, 'Test worktree is unavailable'),
        projectDirectory(record.project.id),
      );
    },
    taskContext(attempt: AttemptDTO) {
      const current = phase(attempt);
      if (attempt.taskId === null || current === undefined || !isFunctionalTestNode(current)) return undefined;
      const { scope } = context(attempt.taskId);
      const snapshot = repo.get(attempt.taskId);
      const run = snapshot.runs.at(-1);
      return {
        phase: current,
        tools: functionalTestTools(current),
        runId: run?.id ?? null,
        environmentReady:
          run?.environment.ready === true && (!scope.target.startsWith('/') || localReady(attempt.taskId)),
        pendingCaseIds: latestCases(snapshot)
          .filter(
            (test) =>
              !snapshot.executions.some(
                (execution) =>
                  execution.runId === run?.id &&
                  execution.caseId === test.id &&
                  execution.version === test.version &&
                  execution.status !== FunctionalTestStatus.Running,
              ),
          )
          .map((test) => test.id),
        lastEvent: snapshot.nextAfter,
      };
    },
    save,
    prepare,
    execute,
    read,
    stop,
    ...revisions,
    latestCases: (taskId: string) => latestCases(read(taskId)),
    readinessChecksFor,
    importCases(taskId: string, cases: FunctionalTestCase[], inheritedChecks: FunctionalTestProbe[]) {
      context(taskId);
      repo.update(taskId, (snapshot) => {
        if (snapshot.cases.length > 0)
          throw new AppError(ErrorCode.StateTransitionInvalid, 'This task already has test cases');
        snapshot.cases.push(...cases);
        snapshot.inheritedChecks = inheritedChecks;
        for (const test of cases)
          repo.event(snapshot, {
            caseId: test.id,
            kind: 'case',
            message: '已沿用原测试的用例版本',
            detail: { version: test.version, title: redactText(test.title) },
          });
      });
    },
    getCaseExecution(taskId: string, executionId: string) {
      const snapshot = read(taskId);
      const execution = find(
        snapshot.executions.find(({ id }) => id === executionId),
        'Functional test execution not found',
      );
      return {
        execution,
        case: caseOf(snapshot, execution.caseId, execution.version),
        run: runOf(snapshot, execution.runId),
        events: snapshot.events.filter((item) => item.executionId === executionId),
      };
    },
    report(taskId: string, runId?: string, version?: number) {
      return find(
        read(taskId, { runId }).reports.findLast((report) => version === undefined || version === report.version),
        'Functional test report not found',
      );
    },
    async submitReport(attempt: AttemptDTO, input: z.output<typeof functionalTestReportSubmitSchema>) {
      const { taskId } = resolve(attempt, [FUNCTIONAL_TEST_NODE.Report]);
      const report = repo.update(taskId, (snapshot) => {
        const report = makeReport(snapshot, runOf(snapshot, input.runId), input, clock.now());
        snapshot.reports.push(report);
        return report;
      });
      await release(taskId);
      return report;
    },
    assertSubmission(attempt: AttemptDTO) {
      if (attempt.taskId === null) return;
      const current = phase(attempt);
      if (current === undefined) return;
      const snapshot = repo.get(attempt.taskId);
      const run = snapshot.runs.at(-1);
      let missing: string | undefined;
      if (
        (current === FUNCTIONAL_TEST_NODE.Author || current === FUNCTIONAL_TEST_NODE.Import) &&
        snapshot.cases.length === 0
      )
        missing = 'Use test_case_save to persist the cases before submitting';
      if (current === FUNCTIONAL_TEST_NODE.Environment && run === undefined)
        missing = 'Use test_environment_prepare before submitting';
      if (
        current === FUNCTIONAL_TEST_NODE.Execute &&
        run?.environment.ready &&
        latestCases(snapshot).some(
          (test) =>
            test.needsClarification === undefined &&
            !snapshot.executions.some(
              (item) =>
                item.runId === run.id &&
                item.caseId === test.id &&
                item.version === test.version &&
                item.status !== FunctionalTestStatus.Running,
            ),
        )
      )
        missing = 'Execute each clear case or record why it is blocked before submitting';
      if (current === FUNCTIONAL_TEST_NODE.Report && snapshot.reports.length === 0)
        missing = 'Use test_report_submit to publish a report before submitting';
      if (missing !== undefined) throw new AppError(ErrorCode.ValidationFailed, missing);
    },
    recover() {
      for (const { taskId } of repo.keys()) {
        if (!repo.get(taskId).executions.some(({ status }) => status === FunctionalTestStatus.Running)) continue;
        repo.update(taskId, (snapshot) => {
          for (const [index, execution] of snapshot.executions.entries()) {
            if (execution.status !== FunctionalTestStatus.Running) continue;
            const status = FunctionalTestStatus.Blocked;
            snapshot.executions[index] = { ...execution, status, finishedAt: clock.now() };
            repo.event(snapshot, {
              runId: execution.runId,
              caseId: execution.caseId,
              executionId: execution.id,
              kind: 'execution',
              message: '应用退出时执行尚未结束，复测前需核实已发送的写入',
              detail: { status, unknownWrite: true },
            });
          }
        });
      }
    },
    async stopAll() {
      await Promise.allSettled([...new Set([...active.keys(), ...ownedPreviews, ...previewLeases.keys()])].map(stop));
    },
  };
}
