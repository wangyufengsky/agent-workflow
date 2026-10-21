import { pathToFileURL } from 'node:url';
import { PromptName, type Prompts } from '@aw/builtin';
import {
  BASH_PERMISSION_PRESETS,
  type BashPolicy,
  MCP_ASSISTANT_SERVER_NAME,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
  OPENCODE_AGENT_NAME,
  OPENCODE_ASSISTANT_AGENT,
  type PermissionAction,
  type PermissionRule,
  RoleBaseAgent,
  readonlyBashRules,
} from '@aw/shared';

export type OpencodeConfigInput = {
  /** `http://127.0.0.1:<apiPort>/mcp/exec` */
  mcpUrl: string;
  mcpToken: string;
  /** `http://127.0.0.1:<apiPort>/mcp/assistant`, with its own token (D25). */
  assistantMcpUrl: string;
  assistantMcpToken: string;
  pluginFile: string;
  prompts: Prompts;
};

type AgentPermission = {
  edit: PermissionAction;
  question: 'deny';
  webfetch: PermissionAction;
  external_directory: 'deny';
};

/** opencode removes the tools a rule denies outright, so each agent only sees its own MCP server's tools. */
const EXEC_TOOLS = `${MCP_TOOL_PREFIX}*`;
const ASSISTANT_TOOLS = `${MCP_ASSISTANT_TOOL_PREFIX}*`;

/**
 * Agent permissions that never change with settings (12 §2). The native question tool is denied: questions go
 * through MCP `ask_user` (D36). Bash rules are per session, see `sessionPermissionRules`. Sessions working on a task
 * never get the assistant's tools (D25).
 */
const AGENT_PERMISSION: Record<RoleBaseAgent, AgentPermission & { [ASSISTANT_TOOLS]: 'deny' }> = {
  [RoleBaseAgent.Planner]: {
    edit: 'deny',
    question: 'deny',
    webfetch: 'deny',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
  [RoleBaseAgent.Executor]: {
    edit: 'allow',
    question: 'deny',
    webfetch: 'ask',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
  [RoleBaseAgent.Reviewer]: {
    edit: 'deny',
    question: 'deny',
    webfetch: 'deny',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
};

/**
 * The assistant (15 §2) writes only inside its own directory (the session directory, `external_directory` denied),
 * asks before fetching the web and never sees the execution MCP's tools. Its bash rules are per session.
 */
const ASSISTANT_PERMISSION = {
  edit: 'allow',
  question: 'deny',
  webfetch: 'ask',
  external_directory: 'deny',
  [EXEC_TOOLS]: 'deny',
} as const satisfies AgentPermission & { [EXEC_TOOLS]: 'deny' };

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
  const remote = (url: string, token: string) => ({
    type: 'remote',
    url,
    headers: { Authorization: `Bearer ${token}` },
    oauth: false,
    enabled: true,
  });
  return {
    mcp: {
      [MCP_SERVER_NAME]: remote(input.mcpUrl, input.mcpToken),
      [MCP_ASSISTANT_SERVER_NAME]: remote(input.assistantMcpUrl, input.assistantMcpToken),
    },
    plugin: [pathToFileURL(input.pluginFile).href],
    agent: {
      ...Object.fromEntries(agents),
      [OPENCODE_ASSISTANT_AGENT]: {
        mode: 'primary',
        description: 'agent-workflow assistant',
        prompt: input.prompts[PromptName.ProtocolAssistant],
        permission: ASSISTANT_PERMISSION,
      },
    },
  };
}

/** The assistant's session bash rules (15 §2): the read-only rules without check commands; anything else asks. */
export const assistantPermissionRules = (): PermissionRule[] => readonlyBashRules();

/**
 * Bash rules passed to `session.create` (D35): read-only for planner and reviewer, `ai.bashPolicy` for executors.
 * Read-only sessions may also run `checkCommands` (the project check and the node's command checks) and the usual
 * test commands of the same tool without asking: running the checks is how a planner or reviewer learns the state of
 * the code, and asking would interrupt the user on every review (D51, D64).
 */
export function sessionPermissionRules(
  base: RoleBaseAgent,
  bashPolicy: BashPolicy,
  checkCommands: readonly string[] = [],
): PermissionRule[] {
  if (base === RoleBaseAgent.Executor) return [...BASH_PERMISSION_PRESETS[bashPolicy]];
  return readonlyBashRules(checkCommands);
}
