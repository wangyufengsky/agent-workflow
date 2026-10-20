import { AttemptKind, ErrorCode, McpToolName, submitPlanInputSchema, submitPlanOutputSchema } from '@aw/shared';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitPlanTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.SubmitPlan,
    description:
      'Submit the plan: a summary and the steps with roles, instructions, dependencies and optional acceptance. The plan is checked; fix the reported problems and submit again until it is accepted.',
    allowedKinds: [AttemptKind.Plan],
    input: submitPlanInputSchema,
    output: submitPlanOutputSchema,
    hints: {
      [ErrorCode.PlanInvalid]:
        'Fix every problem in details.problems (each has its own hint) and call submit_plan again with the whole plan.',
    },
    handler: (input, { attempt }) => tasks.submitPlan(attempt, input),
  });
