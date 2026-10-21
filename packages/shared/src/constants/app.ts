import { RoleBaseAgent } from '../enums/workflow.ts';

export const APP_ID = 'agent-workflow';
export const APP_SOURCE_URL = 'https://github.com/wangyufengsky/agent-workflow';
export const APP_LICENSE = 'Apache-2.0';
/** Exact opencode version this app hosts; any other version is `version_mismatch`. */
export const OPENCODE_VERSION = '1.19.0';
export const OPENCODE_AGENT_NAME = {
  [RoleBaseAgent.Planner]: 'aw-planner',
  [RoleBaseAgent.Executor]: 'aw-executor',
  [RoleBaseAgent.Reviewer]: 'aw-reviewer',
} as const satisfies Record<RoleBaseAgent, string>;
/** The app assistant's agent (15 §2); not a role base agent. */
export const OPENCODE_ASSISTANT_AGENT = 'aw-assistant';
export const MCP_SERVER_NAME = 'agent-workflow';
export const MCP_ASSISTANT_SERVER_NAME = 'agent-workflow-app';
export const TASK_KEY_PREFIX = 'T-';
export const BRANCH_PREFIX = 'aw/';
export const BRANCH_SLUG_MAX = 40;
/** Project slug: the project's directory name under the worktree root. */
export const PROJECT_SLUG_MAX = 40;
export const API_PREFIX = '/api/v1';
export const MCP_EXEC_PATH = '/mcp/exec';
export const MCP_ASSISTANT_PATH = '/mcp/assistant';
/**
 * Assistant working directory under the data directory (03 §7): its sessions run there; generated files go to
 * `files/<conversationId>/`, message streams to `conversations/<conversationId>.jsonl`.
 */
export const ASSISTANT_DIR = 'assistant';
export const ASSISTANT_FILES_DIR = 'files';
export const ASSISTANT_CONVERSATIONS_DIR = 'conversations';
/** Fixed backend port in development so the Vite dev server can proxy to it; production uses a random port. */
export const DEV_API_PORT = 47821;
export const DEV_WEB_PORT = 47822;
/** Written in acceptance commands for the project's check command; replaced when nodes are created (13 §1). */
export const PROJECT_CHECK_PLACEHOLDER = '$PROJECT_CHECK';
/** Author and committer of the commits the backend makes for finished nodes (09 §3). */
export const GIT_COMMIT_IDENTITY = { name: 'agent-workflow', email: 'agent-workflow@localhost' } as const;
