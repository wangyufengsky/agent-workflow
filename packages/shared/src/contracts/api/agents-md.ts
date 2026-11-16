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
  evidenceAttachmentId: z.string().optional(),
});
export type StartAgentsMdTaskRequest = z.infer<typeof startAgentsMdTaskRequestSchema>;

/** The exact source records selected by the user for a project convention proposal. */
export const conventionEvidenceRequestSchema = z
  .object({
    id: z.string(),
    failures: z.array(z.object({ taskId: z.string(), eventId: z.number().int().positive() })).max(30),
    reviews: z.array(z.object({ taskId: z.string(), commentId: z.string() })).max(30),
  })
  .refine((v) => v.failures.length + v.reviews.length > 0);
export type ConventionEvidenceRequest = z.infer<typeof conventionEvidenceRequestSchema>;
export const conventionEvidenceSchema = z.object({
  attachmentId: z.string(),
  text: z.string(),
  suggestions: z.array(
    z.object({
      text: z.string(),
      applicability: z.string(),
      taskId: z.string(),
      eventId: z.number().nullable(),
      commentId: z.string().nullable(),
      nodeId: z.string().nullable(),
      sourceUrl: z.string().nullable(),
    }),
  ),
});
