import { z } from 'zod';
import { acceptanceCheckKindSchema } from '../../enums/task.ts';

/** `get_node_output` (12 §6.2). */
export const getNodeOutputInputSchema = z.object({
  node_key: z.string().min(1).describe('Key of a finished step'),
});
export const getNodeOutputOutputSchema = z.object({
  key: z.string(),
  title: z.string(),
  summary: z.string(),
  changes: z.array(z.object({ path: z.string(), description: z.string() })),
  notes: z.string().optional(),
  assumptions: z.array(z.string()),
  checkResults: z.array(z.object({ kind: acceptanceCheckKindSchema, passed: z.boolean(), output: z.string() })),
});
export type NodeOutput = z.infer<typeof getNodeOutputOutputSchema>;
