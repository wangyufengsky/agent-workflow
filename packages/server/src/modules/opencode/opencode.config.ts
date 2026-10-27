import { pathToFileURL } from 'node:url';
import { PromptName, type Prompts, SkillName } from '@aw/builtin';
import {
  BASH_PERMISSION_PRESETS,
  BashPolicy,
  MCP_ASSISTANT_SERVER_NAME,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
  OPENCODE_AGENT_NAME,
  OPENCODE_ASSISTANT_AGENT,
  OPENCODE_COMPANION_AGENT,
  type PermissionAction,
  type PermissionRule,
  readonlyBashRules,
  SessionAgent,
} from '@aw/shared';

export type OpencodeConfigInput = {
  /** `http://127.0.0.1:<apiPort>/mcp/exec` */
  mcpUrl: string;
  mcpToken: string;
  /** `http://127.0.0.1:<apiPort>/mcp/assistant`, with its own token (D25). */
  assistantMcpUrl: string;
  assistantMcpToken: string;
  pluginFile: string;
  /** The app's own skills (41, D206). */
  skillsDir: string;
  prompts: Prompts;
  /** Pinned shell (Git Bash on Windows, D72); otherwise opencode uses the user's own. */
  shell: string | undefined;
  /** Setting `network.offline` (D168). */
  offline: boolean;
};

type AgentPermission = {
  edit: PermissionAction;
  question: 'deny';
  webfetch: PermissionAction;
  external_directory: 'deny';
  websearch?: 'deny';
  task?: 'deny';
};

/** opencode removes the tools a rule denies outright, so each agent only sees its own MCP server's tools. */
const EXEC_TOOLS = `${MCP_TOOL_PREFIX}*`;
const ASSISTANT_TOOLS = `${MCP_ASSISTANT_TOOL_PREFIX}*`;

/** Agents that only read and answer through their submit tool: no web unless the session allows it, no subagents. */
const READ_ONLY_WRITER = {
  edit: 'deny',
  question: 'deny',
  webfetch: 'deny',
  websearch: 'deny',
  task: 'deny',
  external_directory: 'deny',
  [ASSISTANT_TOOLS]: 'deny',
} as const;

/**
 * Agent permissions that never change with settings (12 §2). The native question tool is denied: questions go
 * through MCP `ask_user` (D36). Bash rules are per session, see `sessionPermissionRules`. Sessions working on a task
 * never get the assistant's tools (D25). The knowledge researcher only reads (18 §5.1, D69): no web unless its session
 * turns it on, and no subagents, which run with their own permissions.
 */
const AGENT_PERMISSION: Record<SessionAgent, AgentPermission & { [ASSISTANT_TOOLS]: 'deny' }> = {
  [SessionAgent.Planner]: {
    edit: 'deny',
    question: 'deny',
    webfetch: 'deny',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
  [SessionAgent.Executor]: {
    edit: 'allow',
    question: 'deny',
    webfetch: 'ask',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
  [SessionAgent.Reviewer]: {
    edit: 'deny',
    question: 'deny',
    webfetch: 'deny',
    external_directory: 'deny',
    [ASSISTANT_TOOLS]: 'deny',
  },
  [SessionAgent.Researcher]: READ_ONLY_WRITER,
  // The PPT writer reads like the researcher and never uses the web (23 §7.1).
  [SessionAgent.SlidesWriter]: READ_ONLY_WRITER,
  // The Git workbench's reviewer reads the user's repository and never uses the web (27 §4.3).
  [SessionAgent.CodeReviewer]: READ_ONLY_WRITER,
};

/**
 * The assistant (15 §2) writes only inside its own directory (the session directory, `external_directory` denied),
 * asks before fetching the web and never sees the execution MCP's tools. Its bash rules are per session.
 */
const ASSISTANT_PERMISSION = {
  edit: 'allow',
  // 原生子代理使用自己的权限，不能代替应用任务的明确授权边界。
  task: 'deny',
  question: 'deny',
  webfetch: 'ask',
  external_directory: 'deny',
  [EXEC_TOOLS]: 'deny',
} as const satisfies AgentPermission & { [EXEC_TOOLS]: 'deny' };

/**
 * The app's skills each agent sees (41 §7.3, D207): an allowlist, so the user's own skills and those of the project's
 * repository never reach an aw session. An agent without skills loses the `skill` tool altogether.
 */
export const AGENT_SKILLS: Record<SessionAgent, SkillName[]> = {
  [SessionAgent.Planner]: [],
  [SessionAgent.Executor]: [],
  [SessionAgent.Reviewer]: [],
  [SessionAgent.Researcher]: [],
  [SessionAgent.SlidesWriter]: [],
  [SessionAgent.CodeReviewer]: [],
};
export const ASSISTANT_SKILLS: SkillName[] = [
  SkillName.TaskRequirement,
  SkillName.TaskDiagnosis,
  SkillName.RecurringWork,
  SkillName.OfficeDocs,
];

/** The catch-all deny comes first: opencode applies the last rule that matches (12 §2). */
const skillPermission = (skills: SkillName[]) =>
  skills.length === 0
    ? ('deny' as const)
    : { '*': 'deny' as const, ...Object.fromEntries(skills.map((skill) => [skill, 'allow' as const])) };

const AGENT_PROMPT: Record<SessionAgent, PromptName> = {
  [SessionAgent.Planner]: PromptName.ProtocolPlan,
  [SessionAgent.Executor]: PromptName.ProtocolExecute,
  [SessionAgent.Reviewer]: PromptName.ProtocolReview,
  [SessionAgent.Researcher]: PromptName.ProtocolResearch,
  [SessionAgent.SlidesWriter]: PromptName.ProtocolSlides,
  [SessionAgent.CodeReviewer]: PromptName.ProtocolCodeReview,
};

/**
 * opencode's own hosted providers (Zen and Go) are listed even without a login and need the internet. A provider left
 * without models is dropped; `disabled_providers` is not used because this array would replace the user's own (D168).
 */
const OFFLINE_CONFIG = {
  provider: { opencode: { whitelist: [] }, 'opencode-go': { whitelist: [] } },
  // Its search services (Exa, Parallel) are on the internet.
  permission: { websearch: 'deny' },
} as const;

/**
 * opencode switches for what reaches the internet on its own (D168, 12 §2): the models.dev catalogue refresh, sharing
 * sessions (`share: "auto"`), downloading language servers (when the user turned `lsp` on) and the update check.
 */
const OFFLINE_ENV = {
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
} as const;

/**
 * opencode skips `.claude/skills` and `.agents/skills`, the user's and the project's (D207): the allowlist already
 * hides them, this spares scanning the home directory for every new worktree.
 */
const SKILL_ENV = { OPENCODE_DISABLE_EXTERNAL_SKILLS: '1' } as const;

/** Injected as `OPENCODE_CONFIG_CONTENT` and merged by opencode with the user's own configuration (12 §2, S3). */
export function buildOpencodeConfig(input: OpencodeConfigInput) {
  const agents = Object.values(SessionAgent).map((base) => [
    OPENCODE_AGENT_NAME[base],
    {
      mode: 'primary',
      description: `agent-workflow ${base}`,
      prompt: input.prompts[AGENT_PROMPT[base]],
      permission: { ...AGENT_PERMISSION[base], skill: skillPermission(AGENT_SKILLS[base]) },
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
    skills: { paths: [input.skillsDir] },
    agent: {
      ...Object.fromEntries(agents),
      [OPENCODE_COMPANION_AGENT]: {
        mode: 'primary',
        description: 'companion small talk',
        prompt: input.prompts[PromptName.ProtocolCompanion],
        permission: { '*': 'deny' },
      },
      [OPENCODE_ASSISTANT_AGENT]: {
        mode: 'primary',
        description: 'agent-workflow assistant',
        prompt: input.prompts[PromptName.ProtocolAssistant],
        permission: { ...ASSISTANT_PERMISSION, skill: skillPermission(ASSISTANT_SKILLS) },
      },
    },
    ...(input.shell === undefined ? {} : { shell: input.shell }),
    ...(input.offline ? OFFLINE_CONFIG : {}),
  };
}

/** The variables a launch of `opencode serve` adds to the backend's environment. */
export function opencodeLaunchEnv(input: OpencodeConfigInput): Record<string, string> {
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeConfig(input)),
    ...SKILL_ENV,
    ...(input.offline ? OFFLINE_ENV : {}),
  };
}

/** shell 的部分读命令不检查 external_directory；助手所有 shell 命令必须先由用户授权（15 §2）。 */
export const assistantPermissionRules = (): PermissionRule[] => [{ permission: 'bash', pattern: '*', action: 'ask' }];

/** A knowledge conversation with web access on (18 §5.1): after the agent's denies, so the last match allows. */
const WEB_RULES: readonly PermissionRule[] = [
  { permission: 'webfetch', pattern: '*', action: 'allow' },
  { permission: 'websearch', pattern: '*', action: 'allow' },
];
/** Offline (D168) only pages can be read, intranet ones: web search needs the internet. */
const OFFLINE_WEB_RULES: readonly PermissionRule[] = [{ permission: 'webfetch', pattern: '*', action: 'allow' }];

/**
 * Rules passed to `session.create` (D35): read-only bash for planner and reviewer, `ai.bashPolicy` for executors.
 * Read-only sessions may also run `checkCommands` (the project check and the node's command checks) and the usual
 * test commands of the same tool without asking: running the checks is how a planner or reviewer learns the state of
 * the code, and asking would interrupt the user on every review (D51, D64). The researcher runs no checks; `web`
 * turns its web tools on (D69), offline only reading pages (D168). `allowedBash` are the patterns the user always allowed in the project (D101); every
 * read-only set takes them, executors under `auto` already run everything but Git.
 */
export function sessionPermissionRules(
  base: SessionAgent,
  bashPolicy: BashPolicy,
  {
    checkCommands = [],
    web = false,
    offline = false,
    allowedBash = [],
  }: {
    checkCommands?: readonly string[] | undefined;
    web?: boolean | undefined;
    offline?: boolean | undefined;
    allowedBash?: readonly string[] | undefined;
  } = {},
): PermissionRule[] {
  if (base === SessionAgent.Executor) {
    return bashPolicy === BashPolicy.Auto
      ? [...BASH_PERMISSION_PRESETS[bashPolicy]]
      : readonlyBashRules([], allowedBash);
  }
  if (base === SessionAgent.Researcher) {
    const webRules = offline ? OFFLINE_WEB_RULES : WEB_RULES;
    return [...readonlyBashRules([], allowedBash), ...(web ? webRules : [])];
  }
  if (base === SessionAgent.SlidesWriter || base === SessionAgent.CodeReviewer)
    return readonlyBashRules([], allowedBash);
  return readonlyBashRules(checkCommands, allowedBash);
}
