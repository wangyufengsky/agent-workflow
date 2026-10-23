import { ViewportPreset } from '../enums/browser.ts';
import { DbType, dbTypeSchema } from '../enums/system.ts';
import { SessionAgent } from '../enums/workflow.ts';

export const APP_ID = 'agent-workflow';
export const APP_SOURCE_URL = 'https://github.com/wangyufengsky/agent-workflow';
export const APP_LICENSE = 'Apache-2.0';
/** Exact opencode version this app hosts; any other version is `version_mismatch`. */
export const OPENCODE_VERSION = '1.19.0';
export const OPENCODE_AGENT_NAME = {
  [SessionAgent.Planner]: 'aw-planner',
  [SessionAgent.Executor]: 'aw-executor',
  [SessionAgent.Reviewer]: 'aw-reviewer',
  [SessionAgent.Researcher]: 'aw-researcher',
  [SessionAgent.SlidesWriter]: 'aw-slides',
  [SessionAgent.CodeReviewer]: 'aw-code-reviewer',
} as const satisfies Record<SessionAgent, string>;
/** The app assistant's agent (15 §2); not a role base agent. */
export const OPENCODE_ASSISTANT_AGENT = 'aw-assistant';
export const OPENCODE_COMPANION_AGENT = 'aw-companion';
export const COMPANION_WHISPER_TIMEOUT_MS = 60_000;
export const COMPANION_WHISPER_MAX_CHARS = 120;
export const MCP_SERVER_NAME = 'agent-workflow';
export const MCP_ASSISTANT_SERVER_NAME = 'agent-workflow-app';
export const TASK_KEY_PREFIX = 'T-';
/** A batch is shown as `B-<seq>` (20 §6). */
export const BATCH_KEY_PREFIX = 'B-';
/** The one placeholder of a batch's requirement template, replaced by each target (20 §2). */
export const BATCH_TARGET_PLACEHOLDER = '{{target}}';
export const BRANCH_PREFIX = 'aw/';
export const BRANCH_SLUG_MAX = 40;
/** Project slug: the project's directory name under the worktree root. */
export const PROJECT_SLUG_MAX = 40;
export const API_PREFIX = '/api/v1';
export const MCP_EXEC_PATH = '/mcp/exec';
export const MCP_ASSISTANT_PATH = '/mcp/assistant';
/** Attachment originals under the data directory (30 §3.1): `attachments/<id>/original`. */
export const ATTACHMENTS_DIR = 'attachments';
/** Request header carrying an upload's URL-encoded display name (11 §14.1). */
export const ATTACHMENT_NAME_HEADER = 'x-attachment-name';
/**
 * Assistant working directory under the data directory (03 §7): its sessions run there; generated files go to
 * `files/<conversationId>/`, message streams to `conversations/<conversationId>.jsonl`.
 */
export const ASSISTANT_DIR = 'assistant';
export const ASSISTANT_FILES_DIR = 'files';
export const ASSISTANT_CONVERSATIONS_DIR = 'conversations';
/**
 * Cited files under these directories, or with these extensions, are documentation; every other file is code
 * (18 §6.1). Matched case-insensitively.
 */
export const KNOWLEDGE_DOC_DIRS = ['docs', 'doc'] as const;
export const KNOWLEDGE_DOC_EXTENSIONS = ['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc'] as const;
/** Fixed backend port in development so the Vite dev server can proxy to it; production uses a random port. */
export const DEV_API_PORT = 47821;
export const DEV_WEB_PORT = 47822;
/** Override the development ports, so several checkouts can run side by side (D78). */
export const DEV_PORT_ENV = { api: 'AW_DEV_API_PORT', web: 'AW_DEV_WEB_PORT' } as const;

/**
 * The development ports, the one place they are read: the Vite configs, Electron main and Playwright all call it.
 * `defaults` replaces the fixed ports for a caller that lets the system choose (browser E2E passes `api: 0`).
 */
export function devPorts(
  env: Readonly<Record<string, string | undefined>>,
  defaults: { api?: number; web?: number } = {},
): { api: number; web: number } {
  return {
    api: parsePort(env, DEV_PORT_ENV.api, defaults.api ?? DEV_API_PORT),
    web: parsePort(env, DEV_PORT_ENV.web, defaults.web ?? DEV_WEB_PORT),
  };
}

function parsePort(env: Readonly<Record<string, string | undefined>>, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number (1-65535), got "${value}"`);
  }
  return port;
}
/** Written in acceptance commands for the project's check command; replaced when nodes are created (13 §1). */
export const PROJECT_CHECK_PLACEHOLDER = '$PROJECT_CHECK';
/** Author and committer of the commits the backend makes for finished nodes (09 §3). */
export const GIT_COMMIT_IDENTITY = { name: 'agent-workflow', email: 'agent-workflow@localhost' } as const;
/** The connection form's port for each database type (24 §2). */
export const DB_DEFAULT_PORT = {
  [DbType.Mysql]: 3306,
  [DbType.Postgresql]: 5432,
  [DbType.Opengauss]: 5432,
  [DbType.Sqlserver]: 1433,
  [DbType.Goldendb]: 3306,
} as const satisfies Record<DbType, number>;
/** The statements `db_query` runs, by the connection's database (24 §4): its SQL dialect decides. */
export const DB_READ_ONLY_STATEMENTS = {
  [DbType.Mysql]: ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'],
  [DbType.Goldendb]: ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'],
  [DbType.Postgresql]: ['SELECT', 'SHOW', 'EXPLAIN'],
  [DbType.Opengauss]: ['SELECT', 'SHOW', 'EXPLAIN'],
  [DbType.Sqlserver]: ['SELECT'],
} as const satisfies Record<DbType, readonly string[]>;

/** `DB_READ_ONLY_STATEMENTS` with the types that allow the same statements together, for descriptions. */
export function readOnlyStatementGroups(): Array<{ types: DbType[]; statements: readonly string[] }> {
  const groups: Array<{ types: DbType[]; statements: readonly string[] }> = [];
  for (const type of dbTypeSchema.options) {
    const statements = DB_READ_ONLY_STATEMENTS[type];
    const same = groups.find((g) => g.statements.join() === statements.join());
    if (same === undefined) groups.push({ types: [type], statements });
    else same.types.push(type);
  }
  return groups;
}

/** CSS pixels of each viewport preset (29 §6 `browser_viewport`); always set through device metrics, DPR 1. */
export const VIEWPORT_SIZES = {
  [ViewportPreset.Desktop]: { width: 1280, height: 800, mobile: false },
  [ViewportPreset.Tablet]: { width: 768, height: 1024, mobile: true },
  [ViewportPreset.Mobile]: { width: 390, height: 844, mobile: true },
} as const satisfies Record<ViewportPreset, { width: number; height: number; mobile: boolean }>;
/** Keys `browser_press` accepts (29 §6), by their DOM `KeyboardEvent.key` names. */
export const BROWSER_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const;
export type BrowserKey = (typeof BROWSER_KEYS)[number];
