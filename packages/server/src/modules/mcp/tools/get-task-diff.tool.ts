import { AttemptKind, ErrorCode, getTaskDiffInputSchema, getTaskDiffOutputSchema, McpToolName } from '@aw/shared';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const getTaskDiffTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.GetTaskDiff,
    description:
      'List the files this task changed so far (committed or not) against its base commit, or get the diff of one of them.',
    allowedKinds: [AttemptKind.Execute, AttemptKind.Review],
    input: getTaskDiffInputSchema,
    output: getTaskDiffOutputSchema,
    hints: {
      [ErrorCode.ValidationFailed]: 'Call get_task_diff without path to list the changed files, then pick one.',
    },
    handler: ({ path }, { attempt }) => tasks.taskDiff(attempt, path),
  });
