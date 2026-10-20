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
/** Commands that only read the workspace; allowed without asking under every policy. */
const BASH_READONLY = ['ls*', 'cat*', 'head*', 'tail*', 'rg*', 'grep*', 'find*', 'wc*', ...GIT_READONLY];

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({ permission: 'bash', pattern, action });

/**
 * Session-level bash rules (12 §2, D35). opencode applies the last matching rule, so the catch-all comes first.
 * Planner and reviewer always use `readonly`; the executor uses the preset of `ai.bashPolicy`.
 */
export const BASH_PERMISSION_PRESETS = {
  readonly: [bash('*', 'ask'), ...BASH_READONLY.map((p) => bash(p, 'allow'))],
  // Git is denied as a whole and only its read-only subcommands are allowed again (12 §1: the model never writes Git).
  [BashPolicy.Auto]: [bash('*', 'allow'), bash('git *', 'deny'), ...GIT_READONLY.map((p) => bash(p, 'allow'))],
  [BashPolicy.Ask]: [bash('*', 'ask'), ...BASH_READONLY.map((p) => bash(p, 'allow'))],
} as const satisfies Record<'readonly' | BashPolicy, readonly PermissionRule[]>;
