import { pathToFileURL } from 'node:url';
import { PromptName, type Prompts } from '@aw/builtin';
import {
  BASH_PERMISSION_PRESETS,
  type BashPolicy,
  MCP_SERVER_NAME,
  OPENCODE_AGENT_NAME,
  type PermissionAction,
  type PermissionRule,
  RoleBaseAgent,
} from '@aw/shared';

export type OpencodeConfigInput = {
  /** `http://127.0.0.1:<apiPort>/mcp/exec` */
  mcpUrl: string;
  mcpToken: string;
  pluginFile: string;
  prompts: Prompts;
};

type AgentPermission = {
  edit: PermissionAction;
  question: 'deny';
  webfetch: PermissionAction;
  external_directory: 'deny';
};

/**
 * Agent permissions that never change with settings (12 §2). The native question tool is denied: questions go
 * through MCP `ask_user` (D36). Bash rules are per session, see `sessionPermissionRules`.
 */
const AGENT_PERMISSION: Record<RoleBaseAgent, AgentPermission> = {
  [RoleBaseAgent.Planner]: { edit: 'deny', question: 'deny', webfetch: 'deny', external_directory: 'deny' },
  [RoleBaseAgent.Executor]: { edit: 'allow', question: 'deny', webfetch: 'ask', external_directory: 'deny' },
  [RoleBaseAgent.Reviewer]: { edit: 'deny', question: 'deny', webfetch: 'deny', external_directory: 'deny' },
};

const AGENT_PROMPT: Record<RoleBaseAgent, PromptName> = {
  [RoleBaseAgent.Planner]: PromptName.ProtocolPlan,
  [RoleBaseAgent.Executor]: PromptName.ProtocolExecute,
  [RoleBaseAgent.Reviewer]: PromptName.ProtocolReview,
};

/** Injected as `OPENCODE_CONFIG_CONTENT` and merged by opencode with the user's own configuration (12 §2, S3). */
export function buildOpencodeConfig(input: OpencodeConfigInput) {
  const agents = Object.values(RoleBaseAgent).map((base) => [
    OPENCODE_AGENT_NAME[base],
    {
      mode: 'primary',
      description: `agent-workflow ${base}`,
      prompt: input.prompts[AGENT_PROMPT[base]],
      permission: AGENT_PERMISSION[base],
    },
  ]);
  return {
    mcp: {
      [MCP_SERVER_NAME]: {
        type: 'remote',
        url: input.mcpUrl,
        headers: { Authorization: `Bearer ${input.mcpToken}` },
        oauth: false,
        enabled: true,
      },
    },
    plugin: [pathToFileURL(input.pluginFile).href],
    agent: Object.fromEntries(agents),
  };
}

/** Bash rules passed to `session.create` (D35): read-only for planner and reviewer, `ai.bashPolicy` for executors. */
export function sessionPermissionRules(base: RoleBaseAgent, bashPolicy: BashPolicy): PermissionRule[] {
  return [...BASH_PERMISSION_PRESETS[base === RoleBaseAgent.Executor ? bashPolicy : 'readonly']];
}
