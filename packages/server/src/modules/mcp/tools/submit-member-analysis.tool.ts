import { AttemptKind, ErrorCode, McpToolName, submitMemberAnalysisInputSchema } from '@aw/shared';
import { z } from 'zod';
import type { TeamService } from '../../team/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitMemberAnalysisTool = (team: TeamService) =>
  defineMcpTool({
    name: McpToolName.SubmitMemberAnalysis,
    description:
      "Submit your analysis of the member's work: an overview, the pieces of work, what was done well and what deserves attention (each citing commits), and the findings of the sampled commits. No scores or grades. Call it exactly once; the analysis is not done until it succeeds.",
    allowedKinds: [AttemptKind.TeamAnalysis],
    input: submitMemberAnalysisInputSchema,
    output: z.object({ accepted: z.literal(true) }),
    hints: {
      [ErrorCode.TeamAnalysisInvalid]:
        'Fix every problem in details.problems (each names the part of the analysis and has its own hint) and call submit_member_analysis again with the whole analysis.',
    },
    handler: async (input, { attempt }) => {
      await team.analyses.submit(attempt, input);
      return { accepted: true as const };
    },
  });
