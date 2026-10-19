import { z } from 'zod';
import { OPENCODE_VERSION } from '../../constants/app.ts';
import { runtimeStatusSchema } from '../../enums/system.ts';

export const healthSchema = z.object({
  status: z.literal('ok'),
  appVersion: z.string(),
  node: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

/** `GET /system/environment` (11 §2): what onboarding checks. */
export const environmentSchema = z.object({
  git: z.object({ installed: z.boolean(), version: z.string().optional() }),
  opencode: z.object({
    status: runtimeStatusSchema,
    path: z.string().optional(),
    version: z.string().optional(),
    requiredVersion: z.literal(OPENCODE_VERSION),
  }),
  models: z.object({
    available: z.array(z.object({ providerId: z.string(), modelId: z.string(), name: z.string() })),
    defaultModel: z.string().optional(),
  }),
  ready: z.boolean(),
});
export type EnvironmentDTO = z.infer<typeof environmentSchema>;
