import { createHash } from 'node:crypto';
import { BuiltinWorkflowKey } from '@aw/builtin';
import {
  AppError,
  ErrorCode,
  type FunctionalTestCase,
  FunctionalTestStatus,
  functionalTestRepairOp,
  functionalTestRerunOp,
  REQUIREMENT_MAX_CHARS,
  ServerEventType,
  TASK_TITLE_MAX_CHARS,
  TaskStatus,
} from '@aw/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import { implement } from '../../core/operations/operations.ts';
import type { FunctionalTestsService } from '../functional-tests/index.ts';
import { runGit } from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import type { TasksService } from './tasks.service.ts';
import { tasksTable, testFollowupsTable } from './tasks.table.ts';

type Dependencies = {
  events: EventBus;
  log: Logger;
  db: Db;
  unit: UnitOfWork;
  tasks: TasksService;
  workflows: WorkflowsService;
  projects: ProjectsService;
  tests: FunctionalTestsService;
};
export function findTestRerunOrigin(db: Db, taskId: string) {
  const row = db
    .select()
    .from(testFollowupsTable)
    .where(and(eq(testFollowupsTable.taskId, taskId), eq(testFollowupsTable.kind, 'rerun')))
    .get();
  return row === undefined ? undefined : { taskId: row.sourceId, executionIds: row.executions };
}

export function createTestFollowups({ db, unit, tasks, workflows, projects, tests, events, log }: Dependencies) {
  async function create(taskId: string, ids: string[], ref?: string) {
    const source = tasks.detail(taskId);
    const scope = source.functionalTest;
    const baseline = source.git.baseCommit;
    if (!scope || !baseline) throw new AppError(ErrorCode.ValidationFailed, 'A prepared functional test is required');
    const executions = [...new Set(ids)].sort();
    const evidence = executions.map((id) => tests.getCaseExecution(taskId, id));
    const kind = ref === undefined ? 'repair' : 'rerun';
    if (kind === 'repair' && evidence.some((e) => e.execution.status !== FunctionalTestStatus.Failed))
      throw new AppError(ErrorCode.ValidationFailed, 'A repair needs a failed execution');
    if (evidence.some((e) => e.execution.status === FunctionalTestStatus.Running))
      throw new AppError(ErrorCode.ValidationFailed, 'An execution is still running');
    const { repoPath } = projects.getRecord(source.project.id);
    const commit =
      ref === undefined
        ? baseline
        : (await runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repoPath })).stdout;
    const requestKey = createHash('sha256')
      .update(JSON.stringify([source.id, kind, executions, commit]))
      .digest('hex');
    const prior = () =>
      db
        .select({ taskId: testFollowupsTable.taskId })
        .from(testFollowupsTable)
        .where(eq(testFollowupsTable.requestKey, requestKey))
        .get();
    const existing = prior();
    if (existing) return existing;
    const workflow = workflows.latest(
      kind === 'repair' ? BuiltinWorkflowKey.Bugfix : BuiltinWorkflowKey.FunctionalTest,
    );
    const cases = new Map<string, FunctionalTestCase>();
    const notes = evidence.map((entry) => {
      const test = entry.case;
      const previous = cases.get(test.id);
      if (previous && previous.version !== test.version)
        throw new AppError(ErrorCode.ValidationFailed, 'Select one revision per case');
      cases.set(test.id, test);
      const failed = entry.events.filter(
        (e) => e.detail.passed === false || e.detail.status === FunctionalTestStatus.Failed,
      );
      const defect = failed.length
        ? failed
        : entry.events.filter((e) => e.kind === 'assertion' || e.kind === 'result').slice(-5);
      const steps = new Set(defect.map((e) => e.step));
      const requests = entry.events.filter((e) => e.kind === 'action' && steps.has(e.step));
      const serviceEvidence = defect
        .filter((e) => typeof e.detail.serviceId === 'string')
        .map(({ seq, detail }) => {
          const log = typeof detail.serviceLog === 'string' ? detail.serviceLog.slice(-600) : '';
          return `服务 ${detail.serviceName ?? detail.serviceId}（${detail.moduleId ?? detail.serviceId}）· 证据 #${seq}
${log}`;
        });
      return [
        `${test.number} v${test.version} ${test.title}`,
        `目标：${test.requirement}`,
        `步骤：${test.steps.map((s) => s.title).join(' → ')}`,
        ...requests.map((e) => `请求 #${e.seq} ${e.detail.method ?? ''} ${e.detail.path ?? e.detail.title ?? ''}`),
        ...serviceEvidence,
        '实测证据：' +
          JSON.stringify(
            defect.map((e) => ({ seq: e.seq, message: e.message, detail: { ...e.detail, serviceLog: undefined } })),
          ).slice(0, 2200),
        `来源执行：${entry.execution.id}，运行：${entry.run.id}`,
      ].join('\n');
    });
    const input = {
      projectId: source.project.id,
      workflowId: workflow.id,
      baseBranch: source.git.baseBranch,
      title: `${kind === 'repair' ? '修复' : '复测'} · ${source.title}`.slice(0, TASK_TITLE_MAX_CHARS),
      requirement: [
        `来源任务 ${source.key}，测试目标 ${scope.target}。被测工作区基线 ${baseline}。`,
        kind === 'repair' ? '复现并修复以下缺陷，按原用例验证修复。' : '按附带的原始用例版本重新执行。',
        ...notes,
      ]
        .join('\n\n')
        .slice(0, REQUIREMENT_MAX_CHARS),
      attachmentIds: source.attachments.map((a) => a.id),
      ...(kind === 'rerun'
        ? {
            functionalTest: {
              target: scope.target,
              writes: scope.writes,
              caseAttachmentIds: scope.caseAttachmentIds,
              ...(scope.compoundLaunch
                ? {
                    compoundSelection: scope.compoundSelection,
                    compoundLaunch: { ...scope.compoundLaunch, baseline: commit },
                  }
                : {}),
            },
          }
        : {}),
    };
    const baseBranch = await tasks.checkCreate(input);
    return unit.transact(() => {
      const duplicate = prior();
      if (duplicate) return duplicate;
      const id = tasks.insertDraft({ ...input, baseBranch, testStartCommit: commit });
      if (kind === 'rerun') tests.importCases(id, [...cases.values()], tests.readinessChecksFor(taskId, executions));
      db.insert(testFollowupsTable).values({ taskId: id, sourceId: taskId, kind, executions, requestKey }).run();
      tasks.publishUpdate(taskId);
      unit.afterCommit(() => tasks.start(id));
      return { taskId: id };
    });
  }
  async function advance(id: string) {
    const repair = db.select().from(testFollowupsTable).where(eq(testFollowupsTable.taskId, id)).get();
    if (repair?.kind === 'repair') {
      const parent = tasks.detail(repair.sourceId);
      if (parent.functionalTest?.onFailure !== 'repair_and_retest' || !parent.functionalTest.target.startsWith('/'))
        return;
      const fixed = tasks.detail(id);
      const commit =
        fixed.lastDelivery?.commitSha ??
        (fixed.git.branch
          ? (
              await runGit(['rev-parse', '--verify', '--end-of-options', `refs/heads/${fixed.git.branch}^{commit}`], {
                cwd: projects.getRecord(fixed.project.id).repoPath,
              })
            ).stdout
          : null);
      if (commit && commit !== parent.git.baseCommit) await create(parent.id, repair.executions, commit);
      return;
    }
    const row = db.select({ scope: tasksTable.functionalTest }).from(tasksTable).where(eq(tasksTable.id, id)).get();
    if (!row?.scope?.onFailure) return;
    const report = tests.read(id).reports.at(-1);
    const failures =
      report?.items.flatMap((item) =>
        item.status === FunctionalTestStatus.Failed && item.executionId ? [item.executionId] : [],
      ) ?? [];
    if (failures.length) await create(id, failures);
  }
  const work = new Map<string, Promise<void>>();
  function enqueue(id: string) {
    if (work.has(id)) return;
    const pending = advance(id)
      .catch((err: unknown) => log.error({ err, taskId: id }, 'could not start test follow-up'))
      .finally(() => work.delete(id));
    work.set(id, pending);
  }
  const ready = [TaskStatus.Review, TaskStatus.Completed] as const;
  const unsubscribe = events.subscribe((event) => {
    if (event.type === ServerEventType.TaskUpdated && ready.some((status) => event.data.status === status))
      enqueue(event.data.id);
  });
  return {
    recover() {
      const rows = db
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .leftJoin(testFollowupsTable, eq(testFollowupsTable.taskId, tasksTable.id))
        .where(
          or(
            and(
              inArray(tasksTable.status, [...ready]),
              or(isNotNull(tasksTable.functionalTest), eq(testFollowupsTable.kind, 'repair')),
            ),
            and(eq(tasksTable.status, TaskStatus.Draft), isNotNull(testFollowupsTable.taskId)),
          ),
        )
        .all();
      for (const { id, status } of rows) {
        if (status === TaskStatus.Draft) tasks.start(id);
        else enqueue(id);
      }
    },
    async close() {
      unsubscribe();
      await Promise.all(work.values());
    },
    operations: [
      implement(functionalTestRepairOp, ({ taskId, executionIds }) => create(taskId, executionIds)),
      implement(functionalTestRerunOp, ({ taskId, executionIds, ref }) => create(taskId, executionIds, ref)),
    ],
  };
}
