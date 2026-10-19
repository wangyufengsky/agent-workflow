import { AttemptKind, getTaskContextInputSchema, getTaskContextOutputSchema, McpToolName } from '@aw/shared';
import type { DebugService } from '../../debug/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const getTaskContextTool = (debug: DebugService) =>
  defineMcpTool({
    name: McpToolName.GetTaskContext,
    description:
      'Get the requirement, your step, its acceptance criteria, results of earlier steps and feedback. Call this first.',
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review],
    input: getTaskContextInputSchema,
    output: getTaskContextOutputSchema,
    // TODO(M3-03): attempts of a task get their context from the task, plan and node.
    handler: (_input, { attempt }) => debug.taskContext(attempt),
  });
