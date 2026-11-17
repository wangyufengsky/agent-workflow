import { AttemptKind, ErrorCode, McpToolName, submitResultInputSchema, submitResultOutputSchema } from '@aw/shared';
import type { DebugService } from '../../debug/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitResultTool = (tasks: TasksService, debug: DebugService) =>
  defineMcpTool({
    name: McpToolName.SubmitResult,
    description:
      'Submit the result of your step once the work is done and checked. Call it exactly once; the step is not finished until it succeeds.',
    allowedKinds: [AttemptKind.Execute],
    input: submitResultInputSchema,
    output: submitResultOutputSchema,
    hints: {
      [ErrorCode.RequirementResultsInvalid]:
        'Give requirement_results only in the step 核验验收清单, once per ai_review item of get_task_context.requirements; leave the field out otherwise.',
    },
    handler: async (input, { attempt }) =>
      attempt.taskId === null
        ? debug.submitResult(attempt, input)
        : { accepted: true as const, next: await tasks.submitResult(attempt, input) },
  });

export const submitBrowserReportTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.BrowserSubmitReport,
    description:
      'Submit your browser test report. Include each test, expected and actual results, pass/fail/blocked, and evidence such as screenshot filenames. Call once when the report is ready.',
    allowedKinds: [AttemptKind.Execute],
    input: submitResultInputSchema.pick({ summary: true, notes: true }).strict(),
    output: submitResultOutputSchema,
    handler: async (input, { attempt }) => ({
      accepted: true as const,
      next: await tasks.submitResult(attempt, input),
    }),
  });
