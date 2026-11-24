import { z } from 'zod';

const reserved = new Set([
  'AW_API_TOKEN',
  'AW_MCP_TOKEN',
  'AW_ASSISTANT_MCP_TOKEN',
  'AW_DATA_DIR',
  'AW_PORT',
  'AW_WEB_DIR',
  'AW_MIGRATIONS_DIR',
  'AW_PROMPTS_DIR',
  'AW_SKILLS_DIR',
  'AW_RIPGREP_DIR',
  'AW_OFFICE_WORKER_FILE',
  'AW_OPENCODE_PLUGIN_FILE',
  'AW_APP_VERSION',
  'AW_FAKE_OPENCODE',
  'AW_FAKE_HOSTING_TOKEN',
  'AW_FAKE_HOSTING_REPO',
  'ELECTRON_RUN_AS_NODE',
  'OPENCODE_CONFIG_CONTENT',
]);

/** These settings go to build and tool processes after boot so they cannot reconfigure the backend's own loader. */
const toolOnly = new Set([
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_AUDIT',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
  'OPENSSL_CONF',
  'OPENSSL_MODULES',
]);

export function isStartupEnvironmentToolOnly(name: string): boolean {
  return toolOnly.has(name.toUpperCase());
}

const name = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a standard environment variable name')
  .refine((value) => !reserved.has(value.toUpperCase()), 'This name is managed by the application');
const value = z.string().refine((value) => !value.includes('\0'), 'Environment values cannot contain NUL');

export const startupEnvironmentInputSchema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    items: z.array(
      z.discriminatedUnion('secret', [
        z.object({ name, secret: z.literal(true), value: value.optional() }),
        z.object({ name, secret: z.literal(false), value }),
      ]),
    ),
  })
  .superRefine(({ items }, ctx) => {
    const keys = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = item.name.toUpperCase();
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'name'],
          message: 'Duplicate environment variable name',
        });
      keys.add(key);
    }
  });
export type StartupEnvironmentInput = z.infer<typeof startupEnvironmentInputSchema>;

export const startupEnvironmentSchema = z.object({
  revision: z.string(),
  items: z.array(
    z.discriminatedUnion('secret', [
      z.object({ name: z.string(), secret: z.literal(true) }),
      z.object({ name: z.string(), secret: z.literal(false), value: z.string() }),
    ]),
  ),
});
export type StartupEnvironment = z.infer<typeof startupEnvironmentSchema>;
