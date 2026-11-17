import { z } from 'zod';

import { ASSISTANT_MEMORY_MAX_CHARS } from '../../constants/limits.ts';

export const assistantMemoryContentSchema = z.string().trim().min(1).max(ASSISTANT_MEMORY_MAX_CHARS);

export const assistantMemoryInputSchema = z.object({
  projectId: z.string().min(1).nullable(),
  content: assistantMemoryContentSchema,
});

export const assistantMemorySchema = assistantMemoryInputSchema.extend({
  id: z.string(),
  sourceConversationId: z.string().nullable(),
  updatedAt: z.number(),
});
export type AssistantMemoryDTO = z.infer<typeof assistantMemorySchema>;
