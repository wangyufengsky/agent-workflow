import type { PluginModule } from '@opencode-ai/plugin';

// The plugin is built into a standalone file that opencode loads (12 §3), so it cannot import @aw/shared;
// its unit test uses MCP_TOOL_PREFIX and MCP_SESSION_ARG, which keeps these equal. Not exported: opencode treats
// the module's exports as plugins.
const TOOL_PREFIX = 'agent-workflow_';
const SESSION_ARG = '__aw_session';

/**
 * Tells our MCP server which session calls a tool (D33): opencode keeps its own reference to `output.args`, so the
 * session id is added in place. Stateless, because opencode loads the plugin once per worktree directory.
 */
const bridge: PluginModule = {
  id: 'agent-workflow-bridge',
  server: async () => ({
    'tool.execute.before': async (input, output) => {
      if (input.tool.startsWith(TOOL_PREFIX)) output.args[SESSION_ARG] = input.sessionID;
    },
  }),
};

// opencode loads a plugin module through its default export.
export default bridge;
