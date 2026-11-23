import type { Prompts } from '@aw/builtin';
import {
  AppError,
  actAssistantBrowserOp,
  assistantBrowserActionSchema,
  assistantBrowserConfirmationSchema,
  assistantToolName,
  attachmentIdsSchema,
  createAssistantMemoryOp,
  createBatchOp,
  createInitiativeOp,
  createProjectOp,
  createScheduleOp,
  createTaskOp,
  createTaskRequestSchema,
  ErrorCode,
  functionalTestApproveRevisionOp,
  functionalTestReadOp,
  functionalTestRepairOp,
  functionalTestReportReadOp,
  functionalTestRerunOp,
  type GetAppStatusOutput,
  initGitOp,
  MCP_ASSISTANT_PATH,
  MCP_ASSISTANT_SERVER_NAME,
  UiMode,
} from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { registerMcpEndpoint } from '../../core/http/mcp-endpoint.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { BatchesService } from '../batches/index.ts';
import type { BrowserService } from '../browser/index.ts';
import type { DecksService } from '../decks/index.ts';
import type { DocumentProcessor } from '../document-processor/index.ts';
import type { GitReviewsService } from '../git-reviews/index.ts';
import type { ImageAnalysis } from '../image-analysis/index.ts';
import type { InitiativesService } from '../initiatives/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { Office } from '../office/index.ts';
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
import { createAssistantMemory } from './assistant.memory.ts';
import { assistantMemoryOperations, proposeMemoryTool, saveConfirmedMemory } from './assistant.memory-operations.ts';
import { officeTools } from './assistant.office.ts';
import { assistantOperations, confirmedBrowserOperation } from './assistant.operations.ts';
import { registerAssistantRoutes } from './assistant.routes.ts';
import { type AssistantServiceDeps, createAssistantService } from './assistant.service.ts';
import { createAssistantSnapshots } from './assistant.snapshots.ts';
import { completeAssistantTaskInput } from './assistant.task-input.ts';
import { createTaskRelay } from './assistant.tasks.ts';
import { createAssistantToolRegistry, NEEDS_CONFIRMATION_INSTRUCTION, operationTools } from './assistant.tools.ts';
import { createWhisperService } from './assistant.whisper.ts';

export type { AssistantService } from './assistant.service.ts';

export type AssistantModuleDeps = Omit<AssistantServiceDeps, 'context' | 'memory'> & {
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
  gitReviews: GitReviewsService;
  team: TeamService;
  browser: BrowserService;
  imageAnalysis: ImageAnalysis;
  documentProcessor: DocumentProcessor;
  /** Word and Excel files: writing them, and the previews of the files cards (39 §7.2, §8.2). */
  office: Office;
  /** Every other operation of the app; the assistant's tools are generated from them (15 §3). */
  operations: readonly OperationImpl[];
  appStatus(): Promise<GetAppStatusOutput>;
};

/** The app assistant (15): conversations, the confirmation flow and the assistant MCP. */
export function createAssistantModule(deps: AssistantModuleDeps) {
  const whisper = createWhisperService(deps);
  const context = createContextRenderer(deps);
  const memory = createAssistantMemory(deps);
  const memoryOperations = assistantMemoryOperations(memory);
  const conversations = createAssistantService({ ...deps, context, memory });
  const taskRelay = createTaskRelay({ ...deps, conversations });
  const analysisRelay = createAnalysisRelay({ ...deps, conversations });
  const breakdownRelay = createBreakdownRelay({ ...deps, conversations });
  // Work the assistant starts and later reports on: tasks (15 §6), member analyses (33 §6), initiatives' AI runs (34 §10).
  const run = async (conversationId: string, impl: OperationImpl, input: unknown) => {
    if (impl.contract.id === actAssistantBrowserOp.id)
      return deps.browser.confirmAssistantAction(
        conversationId,
        assistantBrowserConfirmationSchema.parse(input).requestId,
      );
    if (impl.contract.id === createAssistantMemoryOp.id) return saveConfirmedMemory(memory, conversationId, input);
    if (analysisRelay.handles(impl)) return analysisRelay.run(conversationId, input);
    if (breakdownRelay.handles(impl)) return breakdownRelay.run(conversationId, impl, input);
    return taskRelay.run(conversationId, impl, input);
  };
  const confirmations = createConfirmations({
    run,
    ...deps,
    conversations,
    operations: new Map(
      [...deps.operations, ...memoryOperations, confirmedBrowserOperation].map((impl) => [impl.contract.id, impl]),
    ),
  });
  const relay = createKnowledgeRelay({ ...deps, conversations });
  const projectStarts = [createTaskOp.id, createBatchOp.id, createInitiativeOp.id, createScheduleOp.id];
  const registry = createAssistantToolRegistry(
    [
      ...operationTools(deps.operations, {
        settings: deps.settings,
        run,
        requestConfirmation: confirmations.request,
        recordProduced: conversations.recordProduced,
        deferred: new Map(KNOWLEDGE_QUESTION_OPS.map((id) => [id, relay.researching])),
        completions: new Map([
          [
            createTaskOp.id,
            (given: Record<string, unknown>) => {
              const input = completeAssistantTaskInput(given, deps.workflows);
              return {
                ...input,
                baseBranch: input.baseBranch ?? deps.projects.getRecord(input.projectId).defaultBranch,
              };
            },
          ],
          ...[createBatchOp.id, createInitiativeOp.id].map(
            (id) =>
              [
                id,
                (input: Record<string, unknown>) =>
                  input.baseBranch === undefined
                    ? { ...input, baseBranch: deps.projects.getRecord(z.string().parse(input.projectId)).defaultBranch }
                    : input,
              ] as const,
          ),
        ]),
        prechecks: new Map([
          ...[
            functionalTestRepairOp,
            functionalTestRerunOp,
            functionalTestReadOp,
            functionalTestReportReadOp,
            functionalTestApproveRevisionOp,
          ].map(
            (op) =>
              [
                op.id,
                (conversationId: string, input: Record<string, unknown>) => {
                  const projectId = conversations.get(conversationId).projectId;
                  if (projectId !== null && deps.tasks.detail(z.string().parse(input.taskId)).project.id !== projectId)
                    throw new AppError(ErrorCode.ValidationFailed, 'Start a conversation for the target project');
                },
              ] as const,
          ),
          ...projectStarts.map(
            (id) =>
              [
                id,
                async (conversationId: string, input: Record<string, unknown>) => {
                  const { projectId } = conversations.get(conversationId);
                  if (projectId !== null && projectId !== input.projectId)
                    throw new AppError(ErrorCode.ValidationFailed, 'Start a conversation for the target project', {
                      issues: [
                        {
                          path: ['projectId'],
                          message: 'Use the bound project, or start a new conversation for the target project',
                        },
                      ],
                    });
                  if (id === createTaskOp.id && input.browserTest !== undefined)
                    throw new AppError(ErrorCode.ValidationFailed, 'Set the browser test scope on the task form');
                  if (id === createTaskOp.id || id === createInitiativeOp.id)
                    conversations.assertOwnAttachments(
                      conversationId,
                      attachmentIdsSchema.optional().parse(input.attachmentIds) ?? [],
                    );
                  if (id === createTaskOp.id && input.functionalTest !== undefined) {
                    const request = createTaskRequestSchema.parse(input);
                    if (request.functionalTest?.caseAttachmentIds.some((id) => !request.attachmentIds?.includes(id))) {
                      throw new AppError(ErrorCode.ValidationFailed, 'Case files must be attached to this task', {
                        issues: [
                          {
                            path: ['functionalTest', 'caseAttachmentIds'],
                            message: 'Every case file must also be in attachmentIds',
                          },
                        ],
                      });
                    }
                    await deps.tasks.checkCreateRequest(request);
                  }
                },
              ] as const,
          ),
          // A directory the user would add only to have it refused is answered at once, with its code's hint (D153).
          [createProjectOp.id, (_, input) => deps.projects.assertAddable(z.string().parse(input.repoPath))],
          [initGitOp.id, (_, input) => deps.projects.assertInitable(z.string().parse(input.repoPath))],
        ]),
      }),
      proposeMemoryTool(confirmations, deps.projects),
      {
        name: assistantToolName(actAssistantBrowserOp.id),
        description:
          'Act on the user-selected preview after the user enables control. First call browser_read for refs. ' +
          'Filtering, viewing, same-origin links, typing and selecting may run under one grant with writes blocked. ' +
          'Submitting, sending, deleting, unrecognized buttons, keystrokes and explicit writes require individual confirmation. ' +
          'If the user has taken control, let them finish. Use write only when the method and ' +
          'path are known. Never retry a blocked request on your own. The user handles credentials and verification codes.',
        input: assistantBrowserActionSchema,
        mode: UiMode.Simple,
        async handler(input, { conversation }) {
          const result = await deps.browser.prepareAssistantAction(
            conversation.id,
            assistantBrowserActionSchema.parse(input),
          );
          if ('output' in result) return result.output;
          const confirmation = confirmations.request(conversation.id, actAssistantBrowserOp.id, result.confirmation);
          return {
            status: 'needs_confirmation',
            confirmation_id: confirmation.id,
            instruction: NEEDS_CONFIRMATION_INSTRUCTION,
          };
        },
      },
      ...helperTools({ ...deps, conversations }),
      ...officeTools({ ...deps, conversations }),
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
    operations: [
      ...memoryOperations,
      ...assistantOperations(
        conversations,
        confirmations,
        whisper,
        createAssistantSnapshots(deps),
        deps.browser,
        deps.office,
      ),
    ],
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

export { createBrowserActivity } from './assistant.browser-activity.ts';
