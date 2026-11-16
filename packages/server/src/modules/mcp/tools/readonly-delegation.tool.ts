import {
  AttemptKind,
  delegateReadonlyInputSchema,
  delegateReadonlyOutputSchema,
  inspectDelegationInputSchema,
  inspectDelegationOutputSchema,
  McpToolName,
  submitDelegationInputSchema,
} from '@aw/shared';
import { z } from 'zod';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const delegationTools = (tasks: TasksService) => [
  defineMcpTool({
    name: McpToolName.DelegateReadonly,
    description:
      'Ask up to two independent read-only questions about the current committed task snapshot. Use only for independent code exploration or evidence review. Results return together with source locations. When slots are busy, continue locally.',
    allowedKinds: [AttemptKind.Execute, AttemptKind.Review],
    input: delegateReadonlyInputSchema,
    output: delegateReadonlyOutputSchema,
    handler: ({ questions }, { attempt }) => tasks.delegateReadonly(attempt, questions),
  }),
  defineMcpTool({
    name: McpToolName.InspectDelegation,
    description:
      'Inspect the committed snapshot: list a directory by path, search for a literal query, or read a file from startLine and startOffset. Set both from nextLine and nextOffset to continue.',
    allowedKinds: [AttemptKind.Delegation],
    input: inspectDelegationInputSchema,
    output: inspectDelegationOutputSchema,
    handler: (input, { attempt }) => tasks.inspectDelegation(attempt, input),
  }),
  defineMcpTool({
    name: McpToolName.SubmitDelegation,
    description: 'Return your concise report with the file and line evidence to the parent step.',
    allowedKinds: [AttemptKind.Delegation],
    input: submitDelegationInputSchema,
    output: z.object({ accepted: z.literal(true) }),
    handler: ({ summary }, { attempt }) => {
      tasks.submitDelegation(attempt, summary);
      return { accepted: true as const };
    },
  }),
];
