import { randomUUID } from 'node:crypto';
import {
  AppError,
  type AttemptDTO,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  type FunctionalTestCase,
  type FunctionalTestEvent,
  type FunctionalTestExecution,
  type FunctionalTestPrepare,
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
import { createFunctionalTestRepo } from './functional-tests.repo.ts';
import { latestCases, makeReport } from './functional-tests.reports.ts';
import { functionalTestRevisions } from './functional-tests.revisions.ts';

type Deps = {
  db: Db;
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

function find<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new AppError(ErrorCode.NotFound, message);
  return value;
}

export function createFunctionalTests({
  db,
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
  const previewLeases = new Set<string>();

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

  const localReady = (taskId: string) =>
    previewLeases.has(taskId) && previews.get(taskId).state === PreviewState.Running;
  async function release(taskId: string) {
    if (previewLeases.delete(taskId)) previews.release(taskId);
    if (ownedPreviews.delete(taskId)) await previews.stop(taskId);
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

  function prepare(
    attempt: AttemptDTO,
    { checks }: FunctionalTestPrepare,
    request: AbortSignal | undefined,
  ): Promise<FunctionalTestRun> {
    const { taskId, scope, record } = resolve(attempt, [
      FUNCTIONAL_TEST_NODE.Environment,
      FUNCTIONAL_TEST_NODE.Execute,
    ]);
    if (checks !== undefined && new Set(checks.map(({ key }) => key)).size !== checks.length)
      throw new AppError(ErrorCode.ValidationFailed, 'Readiness check keys must be unique');
    return perform(taskId, attempt, request, async (signal) => {
      const previous = repo.get(taskId).runs.at(-1);
      if (
        previous !== undefined &&
        (!previous.environment.ready || !scope.target.startsWith('/') || localReady(taskId))
      )
        return previous;
      const id = previous?.id ?? randomUUID();
      const baseline = record.git.baseCommit;
      const local = scope.target.startsWith('/');
      const probes: FunctionalTestRun['environment']['checks'] = [];
      let target = scope.target;
      let logTail = '';
      let reason: string | null = null;
      let verified = false;
      emit(taskId, {
        runId: id,
        kind: 'environment',
        message: local ? '启动项目配置的测试服务' : '连接已授权的测试入口',
        detail: {},
      });
      try {
        if (local) {
          const path = find(record.git.worktreePath ?? undefined, 'Test worktree is unavailable');
          const head = (await runGit(['rev-parse', 'HEAD'], { cwd: path })).stdout.trim();
          if (baseline !== head)
            throw new AppError(
              ErrorCode.StateTransitionInvalid,
              'The test worktree differs from the selected baseline',
            );
          signal.throwIfAborted();
          if (previewLeases.has(taskId) && !localReady(taskId)) await release(taskId);
          const state = previews.get(taskId).state;
          if (state !== PreviewState.Running && state !== PreviewState.Starting) ownedPreviews.add(taskId);
          const preview = await previews.start(taskId, { queue: signal, filterLog: redactText });
          signal.throwIfAborted();
          previews.acquire(taskId);
          previewLeases.add(taskId);
          target = new URL(scope.target, find(preview.url ?? undefined, 'Preview has no URL')).href;
          logTail = redactText(preview.logTail);
          verified = true;
        }
        const url = new URL(target);
        const probe = await scopedRequest(url, { method: 'GET', signal }, { origin: url.origin, writes: scope.writes });
        await probe.body?.cancel();
        if (!probe.ok && probe.status !== 401 && probe.status !== 403)
          reason = `测试入口就绪检查返回 HTTP ${probe.status}`;
        for (const check of checks ?? previous?.environment.checks ?? []) {
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
        if (local) logTail = redactText(previews.get(taskId).logTail);
      }
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
          detail: run.environment,
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
    importCases(taskId: string, cases: FunctionalTestCase[]) {
      context(taskId);
      repo.update(taskId, (snapshot) => {
        if (snapshot.cases.length > 0)
          throw new AppError(ErrorCode.StateTransitionInvalid, 'This task already has test cases');
        snapshot.cases.push(...cases);
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
      await Promise.allSettled([...new Set([...active.keys(), ...ownedPreviews, ...previewLeases])].map(stop));
    },
  };
}
