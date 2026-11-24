import { z } from 'zod';

export const investigateDatabaseDescription =
  'Delegate a multi-step, read-only investigation to the database analyst. Use a linked project connection name and a business question. Reuse investigation_id only for a follow-up on the same investigation. Returns an answer, limitations and query evidence. Use the direct database tools for simple queries.';

export const investigateDatabaseInputSchema = z.object({
  connection: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(4000),
  investigation_id: z.string().uuid().optional(),
});
export type InvestigateDatabaseInput = z.infer<typeof investigateDatabaseInputSchema>;

export const databaseInvestigationEvidenceSchema = z.object({
  id: z.string(),
  sql: z.string().nullable(),
  kind: z.enum(['query', 'describe']),
  durationMs: z.number().nonnegative(),
  rowCount: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  summary: z.string(),
});
export const databaseInvestigationSchema = z.object({
  investigationId: z.string().uuid(),
  connection: z.string(),
  question: z.string(),
  attemptId: z.string().optional(),
  status: z.enum(['running', 'completed', 'cancelled', 'failed', 'interrupted']),
  answer: z.string(),
  evidence: z.array(databaseInvestigationEvidenceSchema),
  limitations: z.array(z.string()),
  turns: z
    .array(
      z.object({
        question: z.string(),
        attemptId: z.string().optional(),
        answer: z.string(),
        status: z.enum(['completed', 'cancelled', 'failed', 'interrupted']),
        evidenceIds: z.array(z.string()),
        limitations: z.array(z.string()),
        finishedAt: z.number(),
      }),
    )
    .default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DatabaseInvestigationEvidence = z.infer<typeof databaseInvestigationEvidenceSchema>;
export type DatabaseInvestigation = z.infer<typeof databaseInvestigationSchema>;
export const investigateDatabaseOutputSchema = databaseInvestigationSchema;
export const databaseInvestigationResultSchema = databaseInvestigationSchema;
