import { AttemptKind, McpToolName, reportProgressInputSchema, reportProgressOutputSchema } from '@aw/shared';
import type { AttemptsService } from '../../attempts/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const reportProgressTool = (attempts: AttemptsService, tasks: TasksService) =>
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
      AttemptKind.TeamAnalysis,
      AttemptKind.CommitMessage,
      AttemptKind.Breakdown,
    ],
    input: reportProgressInputSchema,
    output: reportProgressOutputSchema,
    handler: async ({ message, code_review, proposal }, { attempt }) => {
      if (code_review !== undefined || proposal !== undefined)
        await tasks.saveReportDraft(attempt, code_review, proposal);
      attempts.reportProgress(attempt.id, message);
      return { ok: true } as const;
    },
  });
