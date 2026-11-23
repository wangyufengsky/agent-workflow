import { AttemptKind, getTaskContextInputSchema, getTaskContextOutputSchema, McpToolName } from '@aw/shared';
import type { DebugService } from '../../debug/index.ts';
import type { FunctionalTestsService } from '../../functional-tests/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const getTaskContextTool = (tasks: TasksService, debug: DebugService, tests: FunctionalTestsService) =>
  defineMcpTool({
    name: McpToolName.GetTaskContext,
    description:
      'Get the requirement, your step, its acceptance criteria, results of earlier steps, answers and feedback. Call this first.',
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review],
    input: getTaskContextInputSchema,
    output: getTaskContextOutputSchema,
    // Debug attempts (development builds) belong to no task.
    handler: (_input, { attempt }) => {
      if (attempt.taskId === null) return debug.taskContext(attempt);
      const functionalTest = tests.taskContext(attempt);
      return { ...tasks.taskContext(attempt), ...(functionalTest === undefined ? {} : { functionalTest }) };
    },
  });
