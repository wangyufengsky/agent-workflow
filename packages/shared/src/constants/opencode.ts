import { BashPolicy } from '../enums/system.ts';
import { AttemptKind } from '../enums/task.ts';
import { RoleBaseAgent } from '../enums/workflow.ts';
import { MCP_SERVER_NAME } from './app.ts';

/** Prefix opencode puts before our MCP tool names (`agent-workflow_submit_result`). */
export const MCP_TOOL_PREFIX = `${MCP_SERVER_NAME}_`;
/** Argument the bridge plugin injects into our MCP tool calls with the calling session id (12 §3, D33). */
export const MCP_SESSION_ARG = '__aw_session';

/** Base agent each kind of attempt runs as; a role's `base_agent` always matches the kind it is used for. */
export const ATTEMPT_BASE_AGENT = {
  [AttemptKind.Plan]: RoleBaseAgent.Planner,
  [AttemptKind.Execute]: RoleBaseAgent.Executor,
  [AttemptKind.Review]: RoleBaseAgent.Reviewer,
} as const satisfies Record<AttemptKind, RoleBaseAgent>;

/** How long `opencode serve` may take to print its address and answer `/config`. */
export const OPENCODE_START_TIMEOUT_MS = 30_000;

export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionRule = { permission: string; pattern: string; action: PermissionAction };

/** Commands that only read the workspace; allowed without asking under every policy. */
const BASH_READONLY = [
  'ls*',
  'cat*',
  'head*',
  'tail*',
  'rg*',
  'grep*',
  'find*',
  'wc*',
  'git status*',
  'git log*',
  'git diff*',
  'git show*',
];
/** Git writes are the backend's job (12 §1); the model never runs them. */
const BASH_GIT_WRITES = [
  'git commit*',
  'git push*',
  'git checkout*',
  'git switch*',
  'git reset*',
  'git rebase*',
  'git merge*',
  'git branch -D*',
  'git worktree*',
];

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({ permission: 'bash', pattern, action });

/**
 * Session-level bash rules (12 §2, D35). opencode applies the last matching rule, so the catch-all comes first.
 * Planner and reviewer always use `readonly`; the executor uses the preset of `ai.bashPolicy`.
 */
export const BASH_PERMISSION_PRESETS = {
  readonly: [bash('*', 'ask'), ...BASH_READONLY.map((p) => bash(p, 'allow'))],
  [BashPolicy.Auto]: [bash('*', 'allow'), ...BASH_GIT_WRITES.map((p) => bash(p, 'deny'))],
  [BashPolicy.Ask]: [bash('*', 'ask'), ...BASH_READONLY.map((p) => bash(p, 'allow'))],
} as const satisfies Record<'readonly' | BashPolicy, readonly PermissionRule[]>;
