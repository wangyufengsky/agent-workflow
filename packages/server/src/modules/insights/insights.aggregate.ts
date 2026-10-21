import {
  type AttemptKind,
  AttemptStatus,
  type ErrorCode,
  type FailureReasonDTO,
  InsightsDimension,
  InsightsFailureKind,
  type InsightsSummaryDTO,
  type InsightsTaskDTO,
  NodeEvent,
  NodeStatus,
  TaskStatus,
  type UsageGroupDTO,
  type UsageTotals,
} from '@aw/shared';
import { localDateIn, type ResolvedPeriod } from './insights.period.ts';

/** An attempt that started in the period: a task's (plan, execute, review) or a knowledge question's (research). */
export type UsageAttempt = {
  taskId: string | null;
  kind: AttemptKind;
  roleKey: string | null;
  roleName: string | null;
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  startedAt: number;
  projectId: string;
  projectName: string;
  /** Null for research attempts. */
  workflowKey: string | null;
  workflowName: string | null;
};

/** A task that ended in the period (19 §2.4). */
export type EndedTask = {
  id: string;
  status: typeof TaskStatus.Completed | typeof TaskStatus.Cancelled | typeof TaskStatus.Failed;
  endedAt: number;
  startedAt: number | null;
  /** When it first reached review. */
  reviewAt: number | null;
};

/** What the ended tasks did, and the questions and permission requests to count (19 §2.1). */
export type InsightsData = {
  usage: UsageAttempt[];
  ended: EndedTask[];
  /** Nodes of the ended tasks. */
  nodes: { id: string; taskId: string; status: NodeStatus }[];
  /** Execute attempts of the ended tasks. */
  executeAttempts: { taskId: string; nodeId: string; status: AttemptStatus; errorCode: ErrorCode | null }[];
  /** `checks_failed` and `reject` node events of the ended tasks. */
  nodeEvents: { taskId: string; type: string }[];
  /** Questions and permission requests: those of the ended tasks and those created in the period. */
  interruptions: { taskId: string | null; createdAt: number; assumed: boolean }[];
};

/** Task-level figures before the task summary is added. */
export type InsightsTaskFacts = Omit<InsightsTaskDTO, 'task'> & { taskId: string };

const emptyTotals = (): UsageTotals => ({ attempts: 0, tokensInput: 0, tokensOutput: 0 });

/** No usage reported (the session never finished a step) counts as no tokens. */
function addUsage(totals: UsageTotals, a: UsageAttempt): void {
  totals.attempts += 1;
  totals.tokensInput += a.tokensInput ?? 0;
  totals.tokensOutput += a.tokensOutput ?? 0;
}

const GROUP_OF: Record<InsightsDimension, (a: UsageAttempt) => [string | null, string | null]> = {
  [InsightsDimension.Project]: (a) => [a.projectId, a.projectName],
  [InsightsDimension.Workflow]: (a) => [a.workflowKey, a.workflowName],
  [InsightsDimension.Role]: (a) => [a.roleKey, a.roleName],
  [InsightsDimension.Model]: (a) => [a.model, null],
  [InsightsDimension.Kind]: (a) => [a.kind, null],
};

function groupsBy(dimension: InsightsDimension, usage: readonly UsageAttempt[]): UsageGroupDTO[] {
  const groups = new Map<string | null, UsageGroupDTO>();
  for (const a of usage) {
    const [key, name] = GROUP_OF[dimension](a);
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, name, ...emptyTotals() };
      groups.set(key, group);
    }
    addUsage(group, a);
  }
  const tokens = (g: UsageGroupDTO) => g.tokensInput + g.tokensOutput;
  return [...groups.values()].sort((a, b) => tokens(b) - tokens(a) || String(a.key).localeCompare(String(b.key)));
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  const lower = sorted[sorted.length % 2 === 1 ? mid : mid - 1];
  return upper === undefined || lower === undefined ? null : (lower + upper) / 2;
}

/** Rows by task, so that each task's figures do not scan every row. */
function byTask<T extends { taskId: string | null }>(rows: readonly T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const row of rows) map.set(row.taskId, [...(map.get(row.taskId) ?? []), row]);
  return map;
}

type TaskRows = {
  nodes: InsightsData['nodes'];
  executeAttempts: InsightsData['executeAttempts'];
  nodeEvents: InsightsData['nodeEvents'];
  interruptions: InsightsData['interruptions'];
};

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

function countReasons(reasons: readonly Omit<FailureReasonDTO, 'count'>[]): FailureReasonDTO[] {
  const counted = new Map<string, FailureReasonDTO>();
  for (const r of reasons) {
    const id = `${r.kind}:${r.code}`;
    const entry = counted.get(id) ?? { ...r, count: 0 };
    entry.count += 1;
    counted.set(id, entry);
  }
  return [...counted.values()].sort(
    (a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || String(a.code).localeCompare(String(b.code)),
  );
}

/** Quality of one ended task (19 §2.4). */
function qualityOf(task: EndedTask, rows: TaskRows) {
  const effective = new Map<string, number>();
  for (const a of rows.executeAttempts) {
    // An interrupted attempt lost its work to the runtime or the app, not to its quality (09 §3).
    if (a.status !== AttemptStatus.Interrupted) effective.set(a.nodeId, (effective.get(a.nodeId) ?? 0) + 1);
  }
  const { nodes } = rows;
  const done = nodes.filter((n) => n.status === NodeStatus.Done);
  const finished = nodes.filter((n) => n.status === NodeStatus.Done || n.status === NodeStatus.Failed);
  const reasons: Omit<FailureReasonDTO, 'count'>[] = [
    ...rows.nodeEvents.flatMap((e): Omit<FailureReasonDTO, 'count'>[] => {
      if (e.type === NodeEvent.ChecksFailed) return [{ kind: InsightsFailureKind.ChecksFailed, code: null }];
      return e.type === NodeEvent.Reject ? [{ kind: InsightsFailureKind.Rejected, code: null }] : [];
    }),
    // Aborted attempts were stopped by the user or with the task: not a failure.
    ...rows.executeAttempts
      .filter((a) => a.status === AttemptStatus.Failed)
      .map((a) => ({ kind: InsightsFailureKind.AttemptError, code: a.errorCode })),
  ];
  return {
    endedAt: task.endedAt,
    doneNodes: done.length,
    firstPassNodes: done.filter((n) => effective.get(n.id) === 1).length,
    finishedNodes: finished.length,
    retries: finished.reduce((sum, n) => sum + Math.max(0, (effective.get(n.id) ?? 0) - 1), 0),
    // A question answered by the default assumption was only recorded; it did not interrupt anyone.
    interruptions: rows.interruptions.filter((i) => !i.assumed).length,
    reasons,
    reviewDurationMs:
      task.status === TaskStatus.Completed && task.reviewAt !== null && task.startedAt !== null
        ? task.reviewAt - task.startedAt
        : null,
  };
}

/** Every figure of 19 §2 from the rows the repository read. */
export function aggregateInsights(
  period: ResolvedPeriod,
  data: InsightsData,
): { summary: InsightsSummaryDTO; tasks: InsightsTaskFacts[] } {
  const dateOf = localDateIn(period.timeZone);
  const total = emptyTotals();
  for (const a of data.usage) addUsage(total, a);

  const days = new Map(period.dates.map((date) => [date, { date, ...emptyTotals(), tasksCompleted: 0 }]));
  for (const a of data.usage) {
    const day = days.get(dateOf(a.startedAt));
    if (day !== undefined) addUsage(day, a);
  }
  for (const t of data.ended) {
    const day = days.get(dateOf(t.endedAt));
    if (day !== undefined && t.status === TaskStatus.Completed) day.tasksCompleted += 1;
  }

  const rowsOf = {
    nodes: byTask(data.nodes),
    executeAttempts: byTask(data.executeAttempts),
    nodeEvents: byTask(data.nodeEvents),
    interruptions: byTask(data.interruptions),
  };
  const quality = new Map(
    data.ended.map((t) => [
      t.id,
      qualityOf(t, {
        nodes: rowsOf.nodes.get(t.id) ?? [],
        executeAttempts: rowsOf.executeAttempts.get(t.id) ?? [],
        nodeEvents: rowsOf.nodeEvents.get(t.id) ?? [],
        interruptions: rowsOf.interruptions.get(t.id) ?? [],
      }),
    ]),
  );
  const all = [...quality.values()];
  const sum = (pick: (q: (typeof all)[number]) => number) => all.reduce((s, q) => s + pick(q), 0);
  const ended = {
    completed: data.ended.filter((t) => t.status === TaskStatus.Completed).length,
    cancelled: data.ended.filter((t) => t.status === TaskStatus.Cancelled).length,
    failed: data.ended.filter((t) => t.status === TaskStatus.Failed).length,
  };
  const doneNodes = sum((q) => q.doneNodes);
  const firstPassNodes = sum((q) => q.firstPassNodes);
  const finishedNodes = sum((q) => q.finishedNodes);
  const retries = sum((q) => q.retries);
  const interruptions = sum((q) => q.interruptions);

  const summary: InsightsSummaryDTO = {
    period: { period: period.period, from: period.from, to: period.to, timeZone: period.timeZone },
    usage: {
      ...total,
      groups: {
        [InsightsDimension.Project]: groupsBy(InsightsDimension.Project, data.usage),
        [InsightsDimension.Workflow]: groupsBy(InsightsDimension.Workflow, data.usage),
        [InsightsDimension.Role]: groupsBy(InsightsDimension.Role, data.usage),
        [InsightsDimension.Model]: groupsBy(InsightsDimension.Model, data.usage),
        [InsightsDimension.Kind]: groupsBy(InsightsDimension.Kind, data.usage),
      },
    },
    days: [...days.values()],
    quality: {
      ended,
      completionRate: ratio(ended.completed, data.ended.length),
      doneNodes,
      firstPassNodes,
      firstPassRate: ratio(firstPassNodes, doneNodes),
      finishedNodes,
      retries,
      avgRetries: ratio(retries, finishedNodes),
      interruptions,
      avgInterruptions: ratio(interruptions, data.ended.length),
      reviewDurationMedianMs: median(all.flatMap((q) => (q.reviewDurationMs === null ? [] : [q.reviewDurationMs]))),
      failureReasons: countReasons(all.flatMap((q) => q.reasons)),
    },
    attention: {
      interruptions: data.interruptions.filter(
        (i) => !i.assumed && i.createdAt >= period.start && i.createdAt < period.end,
      ).length,
    },
  };

  const taskIds = new Set([
    ...data.ended.map((t) => t.id),
    ...data.usage.flatMap((a) => (a.taskId === null ? [] : [a.taskId])),
  ]);
  const usageOf = byTask(data.usage);
  const tasks = [...taskIds].map((taskId): InsightsTaskFacts => {
    const usage = usageOf.get(taskId) ?? [];
    const usageTotals = emptyTotals();
    for (const a of usage) addUsage(usageTotals, a);
    const q = quality.get(taskId);
    return {
      taskId,
      usage: usageTotals,
      roles: [...new Set(usage.flatMap((a) => (a.roleKey === null ? [] : [a.roleKey])))],
      models: [...new Set(usage.map((a) => a.model))],
      kinds: [...new Set(usage.map((a) => a.kind))],
      quality:
        q === undefined
          ? null
          : {
              endedAt: q.endedAt,
              doneNodes: q.doneNodes,
              firstPassNodes: q.firstPassNodes,
              retries: q.retries,
              interruptions: q.interruptions,
              failureReasons: countReasons(q.reasons),
              reviewDurationMs: q.reviewDurationMs,
            },
    };
  });
  return { summary, tasks };
}
