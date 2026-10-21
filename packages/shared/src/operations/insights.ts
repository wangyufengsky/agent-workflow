import { z } from 'zod';
import { insightsQuerySchema, insightsSummarySchema, insightsTaskSchema } from '../contracts/api/insights.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Read-only figures for both modes; the assistant answers「这周花了多少」with them (D78 ④).
const common = {
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
  risk: OperationRisk.Read,
} as const;

export const insightsSummaryOp = defineOperationContract({
  ...common,
  id: 'insights.summary',
  title: 'op.insights.summary',
  description:
    'Quality and usage over a period in the user time zone: input and output tokens (cost is not counted) broken ' +
    'down by project, workflow, role, model and attempt kind, per day, and the quality of tasks that ended in the ' +
    'period (completion and first-pass rates, retries, failure reasons, interruptions, time to review). Assistant ' +
    'conversations are not counted. "week" starts on Monday; "custom" needs from and to (YYYY-MM-DD)',
  input: insightsQuerySchema,
  output: insightsSummarySchema,
  http: { method: 'GET', path: '/insights' },
});

export const insightsTasksOp = defineOperationContract({
  ...common,
  id: 'insights.tasks',
  title: 'op.insights.tasks',
  description:
    'The tasks a quality and usage period is about (ended in it, or used AI in it), each with its usage in the ' +
    'period, roles and models used, first-pass steps, retries, interruptions, failure reasons and time to review',
  input: insightsQuerySchema,
  output: z.object({ items: z.array(insightsTaskSchema) }),
  http: { method: 'GET', path: '/insights/tasks' },
});
