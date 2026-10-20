import { AttemptKind, ErrorCode, getNodeOutputInputSchema, getNodeOutputOutputSchema, McpToolName } from '@aw/shared';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const getNodeOutputTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.GetNodeOutput,
    description:
      'Get the full result of a finished step of this task: summary, changed files, notes, assumptions, checks.',
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review],
    input: getNodeOutputInputSchema,
    output: getNodeOutputOutputSchema,
    hints: { [ErrorCode.McpNodeNotFound]: 'Use the key of a finished step listed in the plan of get_task_context.' },
    handler: ({ node_key }, { attempt }) => tasks.nodeOutput(attempt, node_key),
  });
