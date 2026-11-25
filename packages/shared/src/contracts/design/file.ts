import { z } from 'zod';
import { designLineSchema, designRelativePathSchema } from './block.ts';

const symbolNamesSchema = z.array(z.string().min(1)).optional();
export const designSymbolSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  qualifiedName: z.string().min(1),
  signature: z.string().optional(),
  lineStart: designLineSchema,
  lineEnd: designLineSchema,
  summary: z.string(),
  throws: symbolNamesSchema,
  callers: symbolNamesSchema,
  callees: symbolNamesSchema,
});
export type DesignSymbol = z.infer<typeof designSymbolSchema>;

export const designFileContentSchema = z.strictObject({
  relPath: designRelativePathSchema,
  responsibility: z.string().trim().min(1),
  symbols: z.array(designSymbolSchema),
});
export type DesignFileContent = z.infer<typeof designFileContentSchema>;
