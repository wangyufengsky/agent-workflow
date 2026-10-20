import { AttemptKind, askUserInputSchema, askUserOutputSchema, ErrorCode, McpToolName } from '@aw/shared';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const askUserTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.AskUser,
    description:
      'Ask the user a question, or record the assumption you continue with. Follow the returned status: continue with proceed_with, or do what instruction says.',
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute],
    input: askUserInputSchema,
    output: askUserOutputSchema,
    hints: {
      [ErrorCode.ValidationFailed]:
        'Fix the arguments in details.issues: a question that does not block you needs a default_assumption to continue with.',
    },
    handler: (input, { attempt }) => tasks.askUser(attempt, input),
  });
