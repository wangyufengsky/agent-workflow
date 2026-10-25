import { z } from 'zod';
import { OPENCODE_VERSION } from '../../constants/app.ts';
import { platformSchema, RuntimeStatus, storageCleanTargetSchema, storageKindSchema } from '../../enums/system.ts';
import { attemptKindSchema } from '../../enums/task.ts';
import { McpToolName } from '../mcp/names.ts';

export const healthSchema = z.object({
  status: z.literal('ok'),
  appVersion: z.string(),
  node: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

const requiredVersion = z.literal(OPENCODE_VERSION);
const located = { path: z.string(), version: z.string(), requiredVersion };

/** `GET /system/runtime` (11 §2): the hosted opencode process. */
export const runtimeSchema = z.discriminatedUnion('status', [
  // A binary may be found yet unusable (`--version` fails): then only its path is known.
  z.object({ status: z.literal(RuntimeStatus.NotInstalled), path: z.string().optional(), requiredVersion }),
  z.object({
    status: z.enum([
      RuntimeStatus.VersionMismatch,
      RuntimeStatus.Stopped,
      RuntimeStatus.Starting,
      RuntimeStatus.Crashed,
    ]),
    ...located,
  }),
  z.object({ status: z.literal(RuntimeStatus.Ready), ...located, url: z.string(), startedAt: z.number() }),
]);
export type RuntimeDTO = z.infer<typeof runtimeSchema>;

export const modelInfoSchema = z.object({ providerId: z.string(), modelId: z.string(), name: z.string() });
export type ModelInfo = z.infer<typeof modelInfoSchema>;

/** `GET /system/environment` (11 §2): what onboarding checks. */
export const environmentSchema = z.object({
  /** Decides the install commands onboarding shows (17 §3.7). */
  platform: platformSchema,
  git: z.discriminatedUnion('installed', [
    z.object({ installed: z.literal(true), version: z.string() }),
    z.object({ installed: z.literal(false) }),
  ]),
  opencode: runtimeSchema,
  models: z.object({
    available: z.array(modelInfoSchema),
    defaultModel: z.string().optional(),
  }),
  /** Secrets (hosting tokens, database passwords) can be stored; not part of `ready` (D74). */
  credentials: z.object({ available: z.boolean() }),
  ready: z.boolean(),
});
export type EnvironmentDTO = z.infer<typeof environmentSchema>;

/** `GET /system/runtime/logs` (11 §2): the end of the newest opencode log. */
export const runtimeLogsSchema = z.object({
  /** File name in `<data dir>/logs`; null before opencode first ran. */
  file: z.string().nullable(),
  lines: z.array(z.string()),
});
export type RuntimeLogsDTO = z.infer<typeof runtimeLogsSchema>;

/** `GET /mcp/tools` (11 §10): one tool of the execution MCP as the tools page shows it. */
export const mcpToolInfoSchema = z.object({
  name: z.enum(McpToolName),
  /** Written for the model (English); the page shows its own description per tool name. */
  description: z.string(),
  /** JSON Schema of the input. */
  inputSchema: z.record(z.string(), z.unknown()),
  allowedKinds: z.array(attemptKindSchema),
});
export type McpToolInfo = z.infer<typeof mcpToolInfoSchema>;

/** `GET /system/storage` (11 §2, 37 §2): the space the data directory and the task worktrees take. */
export const storageSchema = z.object({
  dataDir: z.string(),
  worktreeRoot: z.string(),
  /** Every kind once, in `StorageKind` order; bytes on disk without following symbolic links. */
  items: z.array(z.object({ kind: storageKindSchema, bytes: z.number().int().nonnegative() })),
  totalBytes: z.number().int().nonnegative(),
  /** What each cleanup target would delete now. */
  cleanable: z.array(
    z.object({
      target: storageCleanTargetSchema,
      /** Log files, or tasks whose records go. */
      count: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});
export type StorageDTO = z.infer<typeof storageSchema>;

export const cleanStorageRequestSchema = z.object({ target: storageCleanTargetSchema });
export const cleanStorageResponseSchema = z.object({
  freedBytes: z.number().int().nonnegative(),
  storage: storageSchema,
});
export type CleanStorageResponse = z.infer<typeof cleanStorageResponseSchema>;
