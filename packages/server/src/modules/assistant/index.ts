import type { Prompts } from '@aw/builtin';
import {
  attachmentIdsSchema,
  createInitiativeOp,
  createTaskOp,
  type GetAppStatusOutput,
  MCP_ASSISTANT_PATH,
  MCP_ASSISTANT_SERVER_NAME,
} from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { registerMcpEndpoint } from '../../core/http/mcp-endpoint.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { BatchesService } from '../batches/index.ts';
import type { BrowserService } from '../browser/index.ts';
import type { DecksService } from '../decks/index.ts';
import type { InitiativesService } from '../initiatives/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SchedulesService } from '../schedules/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { TeamService } from '../team/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { createAnalysisRelay } from './assistant.analyses.ts';
import { createBreakdownRelay } from './assistant.breakdowns.ts';
import { createConfirmations } from './assistant.confirmations.ts';
import { createContextRenderer } from './assistant.context.ts';
import { helperTools } from './assistant.helpers.ts';
import { createKnowledgeRelay, KNOWLEDGE_QUESTION_OPS } from './assistant.knowledge.ts';
import { assistantOperations } from './assistant.operations.ts';
import { registerAssistantRoutes } from './assistant.routes.ts';
import { type AssistantServiceDeps, createAssistantService } from './assistant.service.ts';
import { createAssistantSnapshots } from './assistant.snapshots.ts';
import { createTaskRelay } from './assistant.tasks.ts';
import { createAssistantToolRegistry, operationTools } from './assistant.tools.ts';
import { createWhisperService } from './assistant.whisper.ts';

export type { AssistantService } from './assistant.service.ts';

export type AssistantModuleDeps = Omit<AssistantServiceDeps, 'context'> & {
  /** Bearer token of `/mcp/assistant`, separate from the execution MCP's (D25). */
  token: string;
  prompts: Prompts;
  tasks: TasksService;
  projects: ProjectsService;
  workflows: WorkflowsService;
  knowledge: KnowledgeService;
  decks: DecksService;
  batches: BatchesService;
  schedules: SchedulesService;
  initiatives: InitiativesService;
  team: TeamService;
  browser: BrowserService;
  /** Every other operation of the app; the assistant's tools are generated from them (15 §3). */
  operations: readonly OperationImpl[];
  appStatus(): Promise<GetAppStatusOutput>;
};

/** The app assistant (15): conversations, the confirmation flow and the assistant MCP. */
export function createAssistantModule(deps: AssistantModuleDeps) {
  const whisper = createWhisperService(deps);
  const context = createContextRenderer(deps);
  const conversations = createAssistantService({ ...deps, context });
  const taskRelay = createTaskRelay({ ...deps, conversations });
  const analysisRelay = createAnalysisRelay({ ...deps, conversations });
  const breakdownRelay = createBreakdownRelay({ ...deps, conversations });
  // Work the assistant starts and later reports on: tasks (15 §6), member analyses (33 §6), initiatives' AI runs (34 §10).
  const run = (conversationId: string, impl: OperationImpl, input: unknown) => {
    if (analysisRelay.handles(impl)) return analysisRelay.run(conversationId, input);
    if (breakdownRelay.handles(impl)) return breakdownRelay.run(conversationId, impl, input);
    return taskRelay.run(conversationId, impl, input);
  };
  const confirmations = createConfirmations({
    run,
    ...deps,
    conversations,
    operations: new Map(deps.operations.map((impl) => [impl.contract.id, impl])),
  });
  const relay = createKnowledgeRelay({ ...deps, conversations });
  const registry = createAssistantToolRegistry(
    [
      ...operationTools(deps.operations, {
        settings: deps.settings,
        run,
        requestConfirmation: confirmations.request,
        recordProduced: conversations.recordProduced,
        deferred: new Map(KNOWLEDGE_QUESTION_OPS.map((id) => [id, relay.researching])),
        scoped: new Map([
          // Only files of this conversation are handed on (30 §2.2): to a task, or to an initiative (34 §10).
          ...[createTaskOp.id, createInitiativeOp.id].map(
            (id) =>
              [
                id,
                (conversationId: string, input: Record<string, unknown>) =>
                  conversations.assertOwnAttachments(
                    conversationId,
                    attachmentIdsSchema.optional().parse(input.attachmentIds) ?? [],
                  ),
              ] as const,
          ),
        ]),
      }),
      ...helperTools({ ...deps, conversations }),
    ],
    { settings: deps.settings, log: deps.log, findBySession: conversations.findBySession },
  );
  return {
    service: conversations,
    stopWhisper: whisper.stop,
    async start() {
      await Promise.all([analysisRelay.start(), breakdownRelay.start(), taskRelay.start()]);
    },
    registry,
    operations: assistantOperations(
      conversations,
      confirmations,
      whisper,
      createAssistantSnapshots(deps),
      deps.browser,
    ),
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
