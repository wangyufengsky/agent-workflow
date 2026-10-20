import type { FastifyInstance } from 'fastify';
import type { Logger } from '../../core/logger.ts';
import type { AcceptanceService } from '../acceptance/index.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DebugService } from '../debug/index.ts';
import type { TasksService } from '../tasks/index.ts';
import { createToolRegistry, type McpToolDefinition } from './mcp.registry.ts';
import { registerMcpServer } from './mcp.server.ts';
import { askUserTool } from './tools/ask-user.tool.ts';
import { getNodeOutputTool } from './tools/get-node-output.tool.ts';
import { getTaskContextTool } from './tools/get-task-context.tool.ts';
import { getTaskDiffTool } from './tools/get-task-diff.tool.ts';
import { reportProgressTool } from './tools/report-progress.tool.ts';
import { submitPlanTool } from './tools/submit-plan.tool.ts';
import { submitResultTool } from './tools/submit-result.tool.ts';
import { submitReviewTool } from './tools/submit-review.tool.ts';

export type { McpToolDefinition } from './mcp.registry.ts';

export type McpModuleDeps = {
  token: string;
  attempts: AttemptsService;
  tasks: TasksService;
  acceptance: AcceptanceService;
  debug: DebugService;
  log: Logger;
};

export function createMcpModule({ token, attempts, tasks, acceptance, debug, log }: McpModuleDeps) {
  const tools: McpToolDefinition[] = [
    getTaskContextTool(tasks, debug),
    getNodeOutputTool(tasks),
    getTaskDiffTool(tasks),
    submitPlanTool(tasks),
    submitResultTool(tasks, debug),
    submitReviewTool(acceptance),
    askUserTool(tasks),
    reportProgressTool(attempts),
  ];
  const registry = createToolRegistry(tools, attempts, log);
  return { registry, register: (server: FastifyInstance) => registerMcpServer(server, { token, registry }) };
}
