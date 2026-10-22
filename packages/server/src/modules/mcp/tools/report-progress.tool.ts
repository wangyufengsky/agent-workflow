import { AttemptKind, McpToolName, reportProgressInputSchema, reportProgressOutputSchema } from '@aw/shared';
import type { AttemptsService } from '../../attempts/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const reportProgressTool = (attempts: AttemptsService) =>
  defineMcpTool({
    name: McpToolName.ReportProgress,
    description: 'Tell the user in one short line what you are doing now.',
    allowedKinds: [
      AttemptKind.Plan,
      AttemptKind.Execute,
      AttemptKind.Review,
      AttemptKind.Research,
      AttemptKind.DeckOutline,
      AttemptKind.DeckSlides,
      AttemptKind.GitReview,
      AttemptKind.CommitMessage,
    ],
    input: reportProgressInputSchema,
    output: reportProgressOutputSchema,
    handler: ({ message }, { attempt }) => {
      attempts.reportProgress(attempt.id, message);
      return { ok: true } as const;
    },
  });
