import {
  AppError,
  type AssistantConfirmationDTO,
  assistantInputSchema,
  assistantToolName,
  ErrorCode,
  type ErrorInfo,
  isAssistantCallable,
  MCP_SESSION_ARG,
  type NeedsConfirmationOutput,
  type OperationContract,
  OperationRisk,
  UiMode,
} from '@aw/shared';
import { type CallToolResult, type Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { McpTools } from '../../core/http/mcp-endpoint.ts';
import type { Logger } from '../../core/logger.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { SettingsService } from '../settings/index.ts';
import type { Conversation } from './assistant.repo.ts';
import type { TaskRelay } from './assistant.tasks.ts';

export type AssistantToolContext = { conversation: Conversation };

/** One tool of the assistant MCP (15 §3): generated from an operation, or one of the assistant's own. */
export type AssistantTool = {
  name: string;
  /** English, for the model. */
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  /** Lowest interface mode in which the assistant may use it (D65). */
  mode: UiMode;
  handler(input: Record<string, unknown>, ctx: AssistantToolContext): unknown | Promise<unknown>;
};

/** What the model is told to do when a write or critical call waits for the user (15 §4). */
export const NEEDS_CONFIRMATION_INSTRUCTION =
  'The user has to confirm this in the app. Tell them in one sentence what you asked for and end your turn now; ' +
  'the result will be sent to you as the next message.';

const RISK_NOTE: Record<OperationRisk, string> = {
  [OperationRisk.Read]: '',
  [OperationRisk.Write]: " Changes the app: needs the user's confirmation unless they always allow it.",
  [OperationRisk.Critical]: " Cannot be undone easily: needs the user's confirmation every time.",
};

export type OperationToolDeps = {
  settings: SettingsService;
  run: TaskRelay['run'];
  /** Records the object an operation produced in the conversation (D66). */
  recordProduced(conversationId: string, contract: OperationContract, output: unknown): void;
  /**
   * Operations whose outcome arrives later as a message (a knowledge question, 18 §4a): what the tool returns
   * instead of the output; their navigation card comes with that message.
   */
  deferred: ReadonlyMap<string, (conversationId: string, output: unknown) => unknown>;
  /**
   * Checks of an operation's input that run before the call runs or waits for a confirmation, so the card never offers
   * what would be refused: the attachments the calling conversation may pass on (30 §2.2), the directory a project is
   * added from (D153).
   */
  prechecks: ReadonlyMap<string, (conversationId: string, input: Record<string, unknown>) => void | Promise<void>>;
  /** Records a pending confirmation for a call the user has to approve. */
  requestConfirmation(
    conversationId: string,
    operationId: string,
    input: Record<string, unknown>,
  ): AssistantConfirmationDTO;
};

/**
 * Tools from the operation registry (15 §3): every operation exposed to the assistant whose required input it may
 * give, named `domain_action`, with its credential and omitted fields left out. Read calls run at once; write calls
 * run at once only when the user always allows them; everything else waits for a confirmation (D27).
 */
export function operationTools(impls: readonly OperationImpl[], deps: OperationToolDeps): AssistantTool[] {
  return impls
    .filter((impl) => isAssistantCallable(impl.contract))
    .map((impl) => {
      const { contract } = impl;
      return {
        name: assistantToolName(contract.id),
        description: `${contract.description}.${RISK_NOTE[contract.risk]}`,
        input: assistantInputSchema(contract),
        mode: contract.mode,
        async handler(input, { conversation }) {
          await deps.prechecks.get(contract.id)?.(conversation.id, input);
          const allowed =
            contract.risk === OperationRisk.Read ||
            (contract.risk === OperationRisk.Write && deps.settings.get('assistant.alwaysAllow').includes(contract.id));
          if (allowed) {
            // A failing operation answers with its error code, like any tool (12 §5).
            const output = await deps.run(conversation.id, impl, input);
            const deferred = deps.deferred.get(contract.id);
            if (deferred !== undefined) return deferred(conversation.id, output);
            deps.recordProduced(conversation.id, contract, output);
            return output;
          }
          const confirmation = deps.requestConfirmation(conversation.id, contract.id, input);
          return {
            status: 'needs_confirmation',
            confirmation_id: confirmation.id,
            instruction: NEEDS_CONFIRMATION_INSTRUCTION,
          } satisfies NeedsConfirmationOutput;
        },
      } satisfies AssistantTool;
    });
}

const COMMON_HINTS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.BrowserNotOpen]:
    'Ask the user to open their task preview in the desktop app. Do not substitute an AI-owned tab or the most recent task.',
  [ErrorCode.BrowserSiteNotAllowed]: 'The website rules do not allow this address. Do not bypass the rules.',
  [ErrorCode.BrowserLoginRequired]:
    'Ask the user to log in under Settings > Websites, then read the address again. Never ask for or enter credentials.',
  [ErrorCode.BrowserReadFailed]: 'Explain the page load failure to the user using details.reason.',
  [ErrorCode.ProjectPathNoGit]:
    'The directory is not under Git yet. Offer to put it under Git and add it with projects_initGit (same repoPath); the confirmation card shows the user what the first commit takes. projects_previewGitInit tells you that beforehand, for example to warn about large files.',
  [ErrorCode.ValidationFailed]: 'Fix the arguments listed in details.issues and call the tool again.',
  [ErrorCode.McpConversationUnresolved]:
    'This session is not an assistant conversation of agent-workflow; do not call these tools.',
  [ErrorCode.McpToolNotAllowed]:
    'This function needs pro mode. Tell the user; they can switch to pro mode in the settings.',
};

function toolResult(output: unknown): CallToolResult {
  const isObject = typeof output === 'object' && output !== null && !Array.isArray(output);
  // Operations without output (204) still answer the model with something to read.
  const body = output === undefined ? { done: true } : output;
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    ...(isObject ? { structuredContent: Object.fromEntries(Object.entries(output)) } : {}),
  };
}

function errorResult(info: ErrorInfo, hint: string | undefined): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ...info, ...(hint === undefined ? {} : { hint }) }) }],
  };
}

/**
 * `tools/list` and `tools/call` of the assistant MCP: attribution to the calling conversation by the injected
 * session id (12 §3), the interface-mode check, input validation and error mapping (12 §5), in that order.
 */
export function createAssistantToolRegistry(
  tools: readonly AssistantTool[],
  deps: { settings: SettingsService; log: Logger; findBySession(sessionId: string): Conversation | undefined },
): McpTools {
  const { settings, log } = deps;
  const usable = (tool: AssistantTool) => tool.mode === UiMode.Simple || settings.get('ui.mode') === UiMode.Pro;

  function resolveConversation(sessionId: unknown): Conversation {
    const conversation = typeof sessionId === 'string' ? deps.findBySession(sessionId) : undefined;
    if (conversation === undefined) {
      throw new AppError(ErrorCode.McpConversationUnresolved, 'No assistant conversation for this session', {
        sessionId,
      });
    }
    return conversation;
  }

  return {
    list: (): Tool[] =>
      tools.filter(usable).map((t) =>
        ToolSchema.parse({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }),
        }),
      ),

    async call(name, args) {
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) {
        return errorResult({ code: ErrorCode.NotFound, message: `Unknown tool ${name}` }, undefined);
      }
      const { [MCP_SESSION_ARG]: sessionId, ...rest } = args;
      try {
        const conversation = resolveConversation(sessionId);
        if (!usable(tool)) {
          throw new AppError(ErrorCode.McpToolNotAllowed, `${name} needs pro mode`, { mode: settings.get('ui.mode') });
        }
        const parsed = tool.input.safeParse(rest);
        if (!parsed.success) {
          throw new AppError(ErrorCode.ValidationFailed, 'Tool arguments are invalid', { issues: parsed.error.issues });
        }
        const output = await tool.handler(parsed.data, { conversation });
        log.info({ tool: name, conversationId: conversation.id }, 'assistant tool called');
        return toolResult(output);
      } catch (err) {
        if (err instanceof AppError) {
          log.info({ tool: name, code: err.code }, 'assistant tool failed');
          return errorResult(err.toInfo(), COMMON_HINTS[err.code]);
        }
        log.error({ err, tool: name }, 'assistant tool crashed');
        return errorResult({ code: ErrorCode.InternalError, message: 'Internal error' }, undefined);
      }
    },
  };
}
