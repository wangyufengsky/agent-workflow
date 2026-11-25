import { z } from 'zod';
import { MAX_BYTES_PER_TOKEN, MIN_BYTES_PER_TOKEN } from '../../context/limits.ts';

const count = z.number().int().nonnegative();
export const projectionReceiptSchema = z.object({
  sent: z.array(z.string()),
  folded: z.array(z.string()),
  summarized: z.array(z.string()),
  anchor: z.string().nullable(),
  summaryText: z.string().nullable(),
  protected: z.array(z.string()),
});
export type ProjectionReceipt = z.infer<typeof projectionReceiptSchema>;
export const budgetSnapshotSchema = z.object({
  model: z.string(),
  before: count,
  after: count,
  limit: count.nullable(),
  systemTokens: count,
  toolTokens: count,
  dialogueTokens: count,
  toolOutputTokens: count,
  summaryTokens: count,
  mediaTokens: count,
  externalTokens: count,
  outputReserve: count,
  cacheRead: count,
  bytesPerToken: z.number().min(MIN_BYTES_PER_TOKEN).max(MAX_BYTES_PER_TOKEN),
  calibrated: z.boolean(),
  overBudgetWarning: z.boolean(),
  blocked: z.boolean(),
});
export type ContextBudgetSnapshot = z.infer<typeof budgetSnapshotSchema>;
export const contextStatus = z.enum(['kept', 'folded', 'summarized', 'protected', 'archived']);
export const contextDetailSchema = z.object({
  budget: budgetSnapshotSchema.nullable(),
  reconstructed: z.boolean(),
  historyEstimate: count,
  historyParts: z.object({
    system: count,
    tools: count,
    dialogue: count,
    toolOutput: count,
    summary: count,
    media: count,
  }),
  model: z.string().nullable(),
  limit: count.nullable(),
  measuredInput: count.nullable(),
  cacheRead: count.nullable(),
  compactions: count,
  compactionRequests: count,
  managed: z.boolean(),
  stopped: z.boolean(),
  summary: z.object({ uptoMessageId: z.string(), summaryText: z.string(), updatedAt: count }).nullable(),
  folded: z.array(
    z.object({
      path: z.string(),
      messageId: z.string(),
      partId: z.string(),
      length: count,
      referenceLength: count,
      preview: z.string(),
      truncated: z.boolean(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['assistant', 'user']),
      title: z.string(),
      status: contextStatus,
      sent: z.boolean(),
      tokens: count,
      projectedTokens: count,
      projectedPreview: z.string().optional(),
      preview: z.string(),
      length: count,
      truncated: z.boolean(),
    }),
  ),
});
export type ContextDetailDTO = z.infer<typeof contextDetailSchema>;
