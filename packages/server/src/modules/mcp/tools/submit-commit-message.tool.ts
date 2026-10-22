import { AttemptKind, McpToolName, submitCommitMessageInputSchema } from '@aw/shared';
import { z } from 'zod';
import type { CommitDrafts } from '../../git-reviews/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitCommitMessageTool = (drafts: CommitDrafts) =>
  defineMcpTool({
    name: McpToolName.SubmitCommitMessage,
    description: 'Submit the commit message you drafted. Call it exactly once.',
    allowedKinds: [AttemptKind.CommitMessage],
    input: submitCommitMessageInputSchema,
    output: z.object({ accepted: z.literal(true) }),
    handler: (input, { attempt }) => {
      drafts.submit(attempt, input);
      return { accepted: true as const };
    },
  });
