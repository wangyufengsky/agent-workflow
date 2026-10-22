import { z } from 'zod';
import { dbTypeSchema } from '../../enums/system.ts';
import { attemptKindSchema, nodeStatusSchema } from '../../enums/task.ts';
import { workflowDeliverableSchema } from '../../enums/workflow.ts';
import { nodeAcceptanceSchema, planNodeSpecSchema } from '../../workflow/plan-graph.ts';

export const getTaskContextInputSchema = z.object({});

/** `get_task_context` (12 §6.1): everything an attempt needs to know about its task. */
export const getTaskContextOutputSchema = z.object({
  task: z.object({
    key: z.string(),
    title: z.string(),
    requirement: z.string(),
    workflow: z.string(),
    deliverable: workflowDeliverableSchema,
  }),
  project: z.object({ name: z.string(), defaultBranch: z.string() }),
  workspace: z.object({ path: z.string(), branch: z.string(), baseCommit: z.string() }),
  attempt: z.object({ kind: attemptKindSchema, seq: z.number(), retryFeedback: z.string().optional() }),
  askOnUncertainty: z.boolean(),
  plan: z
    .object({
      version: z.number(),
      summary: z.string().optional(),
      nodes: z.array(
        z.object({
          key: z.string(),
          title: z.string(),
          role: z.string(),
          status: nodeStatusSchema,
          dependsOn: z.array(z.string()),
          resultSummary: z.string().optional(),
        }),
      ),
    })
    .optional(),
  node: z
    .object({
      key: z.string(),
      title: z.string(),
      role: z.string(),
      instructions: z.string(),
      acceptance: nodeAcceptanceSchema,
      dependsOn: z.array(z.string()),
    })
    .optional(),
  upstream: z.array(
    z.object({ key: z.string(), title: z.string(), summary: z.string(), changedFiles: z.array(z.string()) }),
  ),
  answeredQuestions: z.array(z.object({ question: z.string(), answer: z.string() })),
  userFeedback: z.array(z.string()),
  planning: z
    .object({
      guidance: z.string().optional(),
      allowedRoles: z.array(z.object({ key: z.string(), name: z.string(), description: z.string() })),
      requiredSteps: z.array(planNodeSpecSchema),
      maxNodes: z.number(),
    })
    .optional(),
  databases: z.array(z.object({ name: z.string(), type: dbTypeSchema })),
});
export type TaskContext = z.infer<typeof getTaskContextOutputSchema>;
