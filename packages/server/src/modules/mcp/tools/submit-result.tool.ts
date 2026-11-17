import { AttemptKind, ErrorCode, McpToolName, submitResultInputSchema, submitResultOutputSchema } from '@aw/shared';
import type { DebugService } from '../../debug/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitResultTool = (tasks: TasksService, debug: DebugService) =>
  defineMcpTool({
    name: McpToolName.SubmitResult,
    description:
      'Submit the result of your step once the work is done and checked. A successful submission finishes the step.',
    allowedKinds: [AttemptKind.Execute],
    input: submitResultInputSchema,
    output: submitResultOutputSchema,
    hints: {
      [ErrorCode.ValidationFailed]: 'Fix the fields named in details.issues and resubmit the corrected result.',
      [ErrorCode.RequirementResultsInvalid]:
        'In 核验验收清单, give one conclusion per ai_review item in get_task_context.requirements. Other steps must omit requirement_results.',
      [ErrorCode.McpToolNotAllowed]:
        'Use the submission tool named in your step instructions. Only the Code Review step can send code_review.',
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
      'Submit your browser test report. Include each test, expected and actual results, pass/fail/blocked, and evidence such as screenshot filenames. A successful submission finishes the step.',
    allowedKinds: [AttemptKind.Execute],
    input: submitResultInputSchema.pick({ summary: true, notes: true }).strict(),
    output: submitResultOutputSchema,
    hints: {
      [ErrorCode.ValidationFailed]:
        'Fix the fields named in details.issues. Send summary and optional notes, preserving screenshot filenames.',
    },
    handler: async (input, { attempt }) => ({
      accepted: true as const,
      next: await tasks.submitResult(attempt, input),
    }),
  });
