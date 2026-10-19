import { z } from 'zod';
import { OPENCODE_VERSION } from '../../constants/app.ts';
import { RuntimeStatus } from '../../enums/system.ts';

export const healthSchema = z.object({
  status: z.literal('ok'),
  appVersion: z.string(),
  node: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

const requiredVersion = z.literal(OPENCODE_VERSION);

/** `GET /system/environment` (11 §2): what onboarding checks. */
export const environmentSchema = z.object({
  git: z.discriminatedUnion('installed', [
    z.object({ installed: z.literal(true), version: z.string() }),
    z.object({ installed: z.literal(false) }),
  ]),
  opencode: z.discriminatedUnion('status', [
    // A binary may be found yet unusable (`--version` fails): then only its path is known.
    z.object({ status: z.literal(RuntimeStatus.NotInstalled), path: z.string().optional(), requiredVersion }),
    z.object({
      status: z.enum([
        RuntimeStatus.VersionMismatch,
        RuntimeStatus.Stopped,
        RuntimeStatus.Starting,
        RuntimeStatus.Ready,
        RuntimeStatus.Crashed,
      ]),
      path: z.string(),
      version: z.string(),
      requiredVersion,
    }),
  ]),
  models: z.object({
    available: z.array(z.object({ providerId: z.string(), modelId: z.string(), name: z.string() })),
    defaultModel: z.string().optional(),
  }),
  ready: z.boolean(),
});
export type EnvironmentDTO = z.infer<typeof environmentSchema>;
