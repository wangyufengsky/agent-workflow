import { BashPolicy } from '../enums/system.ts';
import { MCP_SERVER_NAME } from './app.ts';

/** Prefix opencode puts before our MCP tool names (`agent-workflow_submit_result`). */
export const MCP_TOOL_PREFIX = `${MCP_SERVER_NAME}_`;
/** Argument the bridge plugin injects into our MCP tool calls with the calling session id (12 §3, D33). */
export const MCP_SESSION_ARG = '__aw_session';

/** How long `opencode serve` may take to print its address and answer `/config`. */
export const OPENCODE_START_TIMEOUT_MS = 30_000;

export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionRule = { permission: string; pattern: string; action: PermissionAction };

/** Git subcommands that only read; every other git command writes refs or the worktree, which is the backend's job. */
const GIT_READONLY = [
  'git status*',
  'git log*',
  'git diff*',
  'git show*',
  'git blame*',
  'git grep*',
  'git ls-files*',
  'git rev-parse*',
];
/**
 * Commands that only read the workspace or print; allowed without asking under every policy. Models exploring a
 * repository chain them with `echo` separators and version checks (M6-05 live runs, D61).
 */
const BASH_READONLY = [
  'ls*',
  'cat*',
  'head*',
  'tail*',
  'rg*',
  'grep*',
  'find*',
  'wc*',
  'echo*',
  'pwd',
  'which*',
  'node --version',
  'npm --version',
  'pnpm --version',
  ...GIT_READONLY,
];

/**
 * Arguments that make a command of the read-only list write files or run other programs; such commands ask again
 * (D63). opencode matches each sub-command's full text, redirections included, so a redirect is caught here too.
 */
const BASH_READONLY_ESCAPES = [
  // Redirection: `cat a > b`, `echo x >> f`; also `2>&1`, which only the project check commands are allowed again.
  '*>*',
  'find *-exec*',
  'find *-ok*',
  'find *-delete*',
  'find *-fprint*',
  'find *-fls*',
  'rg *--pre*',
  'git *--output*',
  'git grep *-O*',
  'git grep *--open-files-in-pager*',
];

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({ permission: 'bash', pattern, action });
/** The read-only list, then its escapes: opencode applies the last matching rule. */
const readonlyRules = (): PermissionRule[] => [
  ...BASH_READONLY.map((p) => bash(p, 'allow')),
  ...BASH_READONLY_ESCAPES.map((p) => bash(p, 'ask')),
];

/**
 * Session-level bash rules (12 §2, D35). opencode applies the last matching rule, so the catch-all comes first.
 * Planner and reviewer always use `readonly`; the executor uses the preset of `ai.bashPolicy`.
 */
export const BASH_PERMISSION_PRESETS = {
  readonly: [bash('*', 'ask'), ...readonlyRules()],
  // Git is denied as a whole and only its read-only subcommands are allowed again (12 §1: the model never writes Git).
  [BashPolicy.Auto]: [bash('*', 'allow'), bash('git *', 'deny'), ...GIT_READONLY.map((p) => bash(p, 'allow'))],
  [BashPolicy.Ask]: [bash('*', 'ask'), ...readonlyRules()],
} as const satisfies Record<'readonly' | BashPolicy, readonly PermissionRule[]>;

/** Daily opencode log files in `<data dir>/logs` (03 §7): `opencode-YYYYMMDD.log`. */
export const opencodeLogFile = (date: string) => `opencode-${date}.log`;
export const OPENCODE_LOG_FILE_PATTERN = /^opencode-\d{8}\.log$/;
