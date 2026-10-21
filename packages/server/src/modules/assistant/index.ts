import type { Prompts } from '@aw/builtin';
import { type GetAppStatusOutput, MCP_ASSISTANT_PATH, MCP_ASSISTANT_SERVER_NAME } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { registerMcpEndpoint } from '../../core/http/mcp-endpoint.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { createConfirmations } from './assistant.confirmations.ts';
import { createContextRenderer } from './assistant.context.ts';
import { helperTools } from './assistant.helpers.ts';
import { createKnowledgeRelay, KNOWLEDGE_QUESTION_OPS } from './assistant.knowledge.ts';
import { assistantOperations } from './assistant.operations.ts';
import { registerAssistantRoutes } from './assistant.routes.ts';
import { type AssistantServiceDeps, createAssistantService } from './assistant.service.ts';
import { createAssistantToolRegistry, operationTools } from './assistant.tools.ts';

export type { AssistantService } from './assistant.service.ts';

export type AssistantModuleDeps = Omit<AssistantServiceDeps, 'context'> & {
  /** Bearer token of `/mcp/assistant`, separate from the execution MCP's (D25). */
  token: string;
  prompts: Prompts;
  tasks: TasksService;
  projects: ProjectsService;
  workflows: WorkflowsService;
  knowledge: KnowledgeService;
  /** Every other operation of the app; the assistant's tools are generated from them (15 §3). */
  operations: readonly OperationImpl[];
  appStatus(): Promise<GetAppStatusOutput>;
};

/** The app assistant (15): conversations, the confirmation flow and the assistant MCP. */
export function createAssistantModule(deps: AssistantModuleDeps) {
  const context = createContextRenderer(deps);
  const conversations = createAssistantService({ ...deps, context });
  const confirmations = createConfirmations({
    ...deps,
    conversations,
    operations: new Map(deps.operations.map((impl) => [impl.contract.id, impl])),
  });
  const relay = createKnowledgeRelay({ ...deps, conversations });
  const registry = createAssistantToolRegistry(
    [
      ...operationTools(deps.operations, {
        settings: deps.settings,
        requestConfirmation: confirmations.request,
        recordProduced: conversations.recordProduced,
        deferred: new Map(KNOWLEDGE_QUESTION_OPS.map((id) => [id, relay.researching])),
      }),
      ...helperTools({ ...deps, conversations }),
    ],
    { settings: deps.settings, log: deps.log, findBySession: conversations.findBySession },
  );
  return {
    service: conversations,
    registry,
    operations: assistantOperations(conversations, confirmations),
    register(server: FastifyInstance) {
      registerAssistantRoutes(server, conversations);
      registerMcpEndpoint(server, {
        path: MCP_ASSISTANT_PATH,
        name: MCP_ASSISTANT_SERVER_NAME,
        token: deps.token,
        tools: registry,
      });
    },
  };
}
