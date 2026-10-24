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
