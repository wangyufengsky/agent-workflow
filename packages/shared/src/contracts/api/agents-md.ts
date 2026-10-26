import { z } from 'zod';
import { AGENTS_MD_NOTES_MAX_CHARS } from '../../constants/limits.ts';
import { gitFileSchema } from './git.ts';
import { taskSummarySchema } from './tasks.ts';

/** `GET /projects/:id/agents-md` (40 §6, D203): the root AGENTS.md on the default branch and how to change it. */
export const agentsMdSchema = z.object({
  /** The project's default branch, whose committed AGENTS.md this is: the one tasks start from. */
  branch: z.string(),
  /** Null when the branch has no root AGENTS.md. */
  file: gitFileSchema.nullable(),
  /** The「在 Agent Workflow 中工作」section for this project, as a task would add it (D204). */
  rules: z.string(),
  /** The project's latest AGENTS.md task that has not ended. */
  task: taskSummarySchema.nullable(),
});
export type AgentsMdDTO = z.infer<typeof agentsMdSchema>;

export const startAgentsMdTaskRequestSchema = z.object({
  id: z.string(),
  /** The user's own wishes for the file, added to the task's requirement. */
  guidance: z.string().trim().min(1).max(AGENTS_MD_NOTES_MAX_CHARS).optional(),
  includeRules: z.boolean(),
});
export type StartAgentsMdTaskRequest = z.infer<typeof startAgentsMdTaskRequestSchema>;
