import { readFileSync } from 'node:fs';
import type { PluginModule } from '@opencode-ai/plugin';
import { contextHooks } from './context.ts';

// OpenCode loads this plugin outside the workspace (12 §3), so it cannot import @aw/shared;
// its unit test uses MCP_TOOL_PREFIX, MCP_ASSISTANT_TOOL_PREFIX and MCP_SESSION_ARG, which keeps these equal. Not
// exported: opencode treats the module's exports as plugins.
/** The execution MCP's and the assistant MCP's tools (15 §2): both attribute calls by session. */
const TOOL_PREFIXES = ['agent-workflow_', 'agent-workflow-app_'];
const SESSION_ARG = '__aw_session';

// 多个工作目录共用这一进程的一份启动快照。只读一次管道，头值不进入命令行、子进程环境或 OpenCode 配置。
let startupHeaders: Record<string, string> | undefined;

/**
 * Tells our MCP server which session calls a tool (D33): opencode keeps its own reference to `output.args`, so the
 * session id is added in place.
 */
const bridge: PluginModule = {
  id: 'agent-workflow-bridge',
  server: async (input, options) => {
    if (options?.readHeaderInput === true && startupHeaders === undefined) {
      const raw: unknown = JSON.parse(readFileSync(0, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid startup headers');
      const pairs: [string, string][] = [];
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'string') throw new Error('Invalid startup header value');
        pairs.push([key.toLowerCase(), value]);
      }
      startupHeaders = Object.fromEntries(pairs);
    }
    return {
      ...(typeof options?.contextApi === 'string' && typeof options.contextToken === 'string'
        ? contextHooks(input, options.contextApi, options.contextToken)
        : {}),
      'chat.headers': async (_input, output) => {
        if (startupHeaders === undefined) return;
        for (const key of Object.keys(output.headers)) {
          if (Object.hasOwn(startupHeaders, key.toLowerCase())) delete output.headers[key];
        }
        for (const [key, value] of Object.entries(startupHeaders)) {
          Object.defineProperty(output.headers, key, { value, enumerable: true, writable: true, configurable: true });
        }
      },
      'tool.execute.before': async (input, output) => {
        if (TOOL_PREFIXES.some((prefix) => input.tool.startsWith(prefix))) output.args[SESSION_ARG] = input.sessionID;
      },
    };
  },
};

// opencode loads a plugin module through its default export.
export default bridge;
