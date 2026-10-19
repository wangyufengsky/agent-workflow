import type { FastifyInstance } from 'fastify';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DebugService } from '../debug/index.ts';
import { createToolRegistry, type McpToolDefinition } from './mcp.registry.ts';
import { registerMcpServer } from './mcp.server.ts';
import { getTaskContextTool } from './tools/get-task-context.tool.ts';
import { reportProgressTool } from './tools/report-progress.tool.ts';
import { submitResultTool } from './tools/submit-result.tool.ts';

export type { McpToolDefinition } from './mcp.registry.ts';

export type McpModuleDeps = { token: string; attempts: AttemptsService; debug: DebugService; log: Logger };

export function createMcpModule({ token, attempts, debug, log }: McpModuleDeps) {
  const tools: McpToolDefinition[] = [getTaskContextTool(debug), reportProgressTool(attempts), submitResultTool(debug)];
  const registry = createToolRegistry(tools, attempts, log);
  return { registry, register: (server: FastifyInstance) => registerMcpServer(server, { token, registry }) };
}
