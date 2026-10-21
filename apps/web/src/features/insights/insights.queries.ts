import { type InsightsQuery, insightsSummaryOp, insightsTasksOp } from '@aw/shared';
import { queryOptions } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const insightsSummaryQuery = (query: InsightsQuery) =>
  queryOptions({
    queryKey: queryKeys.insights('summary', query),
    queryFn: () => callOperation(insightsSummaryOp, query),
  });

export const insightsTasksQuery = (query: InsightsQuery) =>
  queryOptions({
    queryKey: queryKeys.insights('tasks', query),
    queryFn: () => callOperation(insightsTasksOp, query),
  });
