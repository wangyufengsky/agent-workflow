import {
  AppError,
  ATTEMPT_SUBMIT_TOOL,
  type AttemptDTO,
  type AttemptKind,
  AttemptStatus,
  ErrorCode,
  type ErrorInfo,
  MCP_SESSION_ARG,
  type McpToolInfo,
  type McpToolName,
} from '@aw/shared';
import { type CallToolResult, type Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Logger } from '../../core/logger.ts';

export type McpToolContext = { attempt: AttemptDTO };

/** One execution MCP tool (03 §4.2 extension point): schema, allowed attempt kinds and a handler that only forwards. */
export type McpToolDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
> = {
  name: McpToolName;
  /** English, for the model. */
  description: string;
  allowedKinds: readonly AttemptKind[];
  input: I;
  output: O;
  /** Tool-specific advice per error code, returned to the model with the error (08 §5.1). */
  hints?: Partial<Record<ErrorCode, string>>;
  handler(input: z.output<I>, ctx: McpToolContext): z.input<O> | Promise<z.input<O>>;
};

export function defineMcpTool<I extends z.ZodObject, O extends z.ZodType<Record<string, unknown>>>(
  tool: McpToolDefinition<I, O>,
): McpToolDefinition<I, O> {
  return tool;
}

/** How the model can recover from the failures every tool shares. */
const COMMON_HINTS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.ValidationFailed]: 'Fix the arguments listed in details.issues and call the tool again.',
  [ErrorCode.McpAttemptUnresolved]:
    'This session no longer runs an agent-workflow step. Stop working and end your turn.',
  [ErrorCode.McpToolNotAllowed]: 'This tool is not available in this session. Use the tools your instructions name.',
  [ErrorCode.McpResultAlreadySubmitted]: 'Your result is already recorded. End your turn now.',
};

export type ToolRegistry = {
  list(): Tool[];
  /** What the MCP tools page shows (11 §10). */
  info(): McpToolInfo[];
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
};

export type AttemptLookup = { findLatestBySession(sessionId: string): AttemptDTO | undefined };

/**
 * Turns tool definitions into the MCP `tools/list` and `tools/call` behaviour (12 §7): attribution through the
 * injected session id, attempt-kind authorization, input validation and error mapping, in that order.
 */
export function createToolRegistry(
  tools: readonly McpToolDefinition[],
  attempts: AttemptLookup,
  log: Logger,
): ToolRegistry {
  function resolveAttempt(tool: McpToolDefinition, sessionId: unknown): AttemptDTO {
    const attempt = typeof sessionId === 'string' ? attempts.findLatestBySession(sessionId) : undefined;
    if (attempt === undefined) {
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'No attempt for this session', { sessionId });
    }
    const submitsResult = Object.values(ATTEMPT_SUBMIT_TOOL).some((name) => name === tool.name);
    if (attempt.status === AttemptStatus.Succeeded && submitsResult) {
      throw new AppError(ErrorCode.McpResultAlreadySubmitted, 'The attempt already submitted its result', {
        attemptId: attempt.id,
      });
    }
    if (attempt.status !== AttemptStatus.Starting && attempt.status !== AttemptStatus.Running) {
      throw new AppError(ErrorCode.McpAttemptUnresolved, `Attempt ${attempt.id} is ${attempt.status}`, {
        attemptId: attempt.id,
      });
    }
    if (!tool.allowedKinds.includes(attempt.kind)) {
      throw new AppError(ErrorCode.McpToolNotAllowed, `${tool.name} is not allowed in ${attempt.kind} attempts`, {
        kind: attempt.kind,
        allowedKinds: tool.allowedKinds,
      });
    }
    return attempt;
  }

  function errorResult(info: ErrorInfo, hint: string | undefined): CallToolResult {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ...info, ...(hint === undefined ? {} : { hint }) }) }],
    };
  }

  return {
    list: () =>
      tools.map((t) =>
        ToolSchema.parse({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
        }),
      ),

    info: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
        allowedKinds: [...t.allowedKinds],
      })),

    async call(name, args) {
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) {
        return errorResult({ code: ErrorCode.NotFound, message: `Unknown tool ${name}` }, undefined);
      }
      const { [MCP_SESSION_ARG]: sessionId, ...rest } = args;
      try {
        const attempt = resolveAttempt(tool, sessionId);
        const parsed = tool.input.safeParse(rest);
        if (!parsed.success) {
          throw new AppError(ErrorCode.ValidationFailed, 'Tool arguments are invalid', { issues: parsed.error.issues });
        }
        const output = tool.output.parse(await tool.handler(parsed.data, { attempt }));
        log.info({ tool: name, attemptId: attempt.id }, 'mcp tool called');
        return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
      } catch (err) {
        if (err instanceof AppError) {
          log.info({ tool: name, code: err.code }, 'mcp tool failed');
          return errorResult(err.toInfo(), tool.hints?.[err.code] ?? COMMON_HINTS[err.code]);
        }
        log.error({ err, tool: name }, 'mcp tool crashed');
        return errorResult({ code: ErrorCode.InternalError, message: 'Internal error' }, undefined);
      }
    },
  };
}
