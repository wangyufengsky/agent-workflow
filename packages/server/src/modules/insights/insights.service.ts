import type { InsightsQuery, InsightsSummaryDTO, InsightsTaskDTO } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { DbExecutor } from '../../core/db/database.ts';
import type { TasksService } from '../tasks/index.ts';
import { aggregateInsights } from './insights.aggregate.ts';
import { resolvePeriod } from './insights.period.ts';
import { createInsightsRepo } from './insights.repo.ts';

export type InsightsServiceDeps = {
  db: DbExecutor;
  clock: Clock;
  /** The user's time zone: days and「今天」are counted in it (19 §2.2). */
  timeZone: string;
  tasks: TasksService;
};

/** Quality and usage (19): read-only figures computed from what the app already stores. */
export function createInsightsService({ db, clock, timeZone, tasks }: InsightsServiceDeps) {
  const repo = createInsightsRepo(db);

  function analyse(query: InsightsQuery) {
    const period = resolvePeriod(query, clock.now(), timeZone);
    return aggregateInsights(period, repo.read(period.start, period.end));
  }

  return {
    summary: (query: InsightsQuery): InsightsSummaryDTO => analyse(query).summary,

    /** Ended tasks by end time, then the others by creation, most recent first. */
    tasks(query: InsightsQuery): { items: InsightsTaskDTO[] } {
      const facts = analyse(query).tasks;
      const summaries = new Map(tasks.summariesOf(facts.map((f) => f.taskId)).map((s) => [s.id, s]));
      const items = facts.map(({ taskId, ...rest }) => {
        const task = summaries.get(taskId);
        if (task === undefined) throw new Error(`No summary for task ${taskId}`);
        return { task, ...rest };
      });
      const endedAt = (i: InsightsTaskDTO) => i.quality?.endedAt ?? Number.NEGATIVE_INFINITY;
      return { items: items.sort((x, y) => endedAt(y) - endedAt(x) || y.task.createdAt - x.task.createdAt) };
    },
  };
}
export type InsightsService = ReturnType<typeof createInsightsService>;
