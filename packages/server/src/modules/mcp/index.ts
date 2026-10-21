import { listMcpToolsOp, MCP_EXEC_PATH, MCP_SERVER_NAME } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { registerMcpEndpoint } from '../../core/http/mcp-endpoint.ts';
import type { Logger } from '../../core/logger.ts';
import { implement } from '../../core/operations/operations.ts';
import type { AcceptanceService } from '../acceptance/index.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DebugService } from '../debug/index.ts';
import type { DecksService } from '../decks/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { TasksService } from '../tasks/index.ts';
import { createToolRegistry, type McpToolDefinition } from './mcp.registry.ts';
import { askUserTool } from './tools/ask-user.tool.ts';
import { dbDescribeTool, dbListConnectionsTool, dbQueryTool } from './tools/db-tools.tool.ts';
import { getNodeOutputTool } from './tools/get-node-output.tool.ts';
import { getTaskContextTool } from './tools/get-task-context.tool.ts';
import { getTaskDiffTool } from './tools/get-task-diff.tool.ts';
import { reportProgressTool } from './tools/report-progress.tool.ts';
import { submitAnswerTool } from './tools/submit-answer.tool.ts';
import { submitOutlineTool } from './tools/submit-outline.tool.ts';
import { submitPlanTool } from './tools/submit-plan.tool.ts';
import { submitResultTool } from './tools/submit-result.tool.ts';
import { submitReviewTool } from './tools/submit-review.tool.ts';
import { submitSlideTool } from './tools/submit-slide.tool.ts';

export type { McpToolDefinition } from './mcp.registry.ts';

export type McpModuleDeps = {
  token: string;
  attempts: AttemptsService;
  tasks: TasksService;
  acceptance: AcceptanceService;
  debug: DebugService;
  knowledge: KnowledgeService;
  decks: DecksService;
  log: Logger;
};

export function createMcpModule({ token, attempts, tasks, acceptance, debug, knowledge, decks, log }: McpModuleDeps) {
  const tools: McpToolDefinition[] = [
    getTaskContextTool(tasks, debug),
    getNodeOutputTool(tasks),
    getTaskDiffTool(tasks),
    submitPlanTool(tasks),
    submitResultTool(tasks, debug),
    submitReviewTool(acceptance),
    askUserTool(tasks),
    reportProgressTool(attempts),
    dbListConnectionsTool(tasks, knowledge),
    dbDescribeTool(tasks, knowledge),
    dbQueryTool(tasks, knowledge),
    submitAnswerTool(knowledge),
    submitOutlineTool(decks),
    submitSlideTool(decks),
  ];
  const registry = createToolRegistry(tools, attempts, log);
  return {
    registry,
    operations: [implement(listMcpToolsOp, () => ({ items: registry.info() }))],
    register: (server: FastifyInstance) =>
      registerMcpEndpoint(server, { path: MCP_EXEC_PATH, name: MCP_SERVER_NAME, token, tools: registry }),
  };
}
