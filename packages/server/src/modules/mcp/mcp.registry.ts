import {
  AppError,
  type AttemptDTO,
  type AttemptKind,
  AttemptStatus,
  BROWSER_TEST_TOOLS,
  type BrowserTestSubmitTool,
  ErrorCode,
  type ErrorInfo,
  functionalTestTools,
  isAttemptSubmitTool,
  isFunctionalTestNode,
  MCP_SESSION_ARG,
  type McpToolInfo,
  McpToolName,
} from '@aw/shared';
import { type CallToolResult, type Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Logger } from '../../core/logger.ts';

export type McpToolContext = { attempt: AttemptDTO; signal?: AbortSignal | undefined };

/** Images a tool returns beside its output (a screenshot, 29 §5.7): MCP image content, kept out of the JSON. */
export const MCP_IMAGES = Symbol('mcp images');
export type McpImage = { data: string; mimeType: string };
type ToolReturn<O extends z.ZodType> = z.input<O> & { [MCP_IMAGES]?: readonly McpImage[] };

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
  handler(input: z.output<I>, ctx: McpToolContext): ToolReturn<O> | Promise<ToolReturn<O>>;
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
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
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
  browserTestSubmit: (attempt: AttemptDTO) => BrowserTestSubmitTool | undefined,
  rejectionGuide: (
    attempt: AttemptDTO,
    name: McpToolName,
    args: Record<string, unknown>,
    error: ErrorInfo,
  ) => { next: string } | undefined,
  functionalPhase: (attempt: AttemptDTO) => string | undefined,
): ToolRegistry {
  function resolveAttempt(tool: McpToolDefinition, sessionId: unknown, attempt: AttemptDTO | undefined): AttemptDTO {
    if (attempt === undefined) {
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'No attempt for this session', { sessionId });
    }
    if (attempt.status === AttemptStatus.Succeeded && isAttemptSubmitTool(tool.name)) {
      throw new AppError(ErrorCode.McpResultAlreadySubmitted, 'The attempt already submitted its result', {
        attemptId: attempt.id,
      });
    }
    if (attempt.status !== AttemptStatus.Starting && attempt.status !== AttemptStatus.Running) {
      throw new AppError(ErrorCode.McpAttemptUnresolved, `Attempt ${attempt.id} is ${attempt.status}`, {
        attemptId: attempt.id,
      });
    }
    const phase = functionalPhase(attempt);
    if (phase !== undefined && isFunctionalTestNode(phase) && !functionalTestTools(phase).includes(tool.name)) {
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This functional test step can only use its declared tools');
    }
    if (tool.name.startsWith('test_') && (phase === undefined || !isFunctionalTestNode(phase))) {
      throw new AppError(ErrorCode.McpToolNotAllowed, 'Only functional test steps can use this tool');
    }
    const testSubmit = browserTestSubmit(attempt);
    if (tool.name === McpToolName.BrowserSubmitReport && testSubmit !== tool.name) {
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This tool is only for the browser test report step');
    }
    // A session from an earlier version may still have the previous submit_result permission.
    if (
      testSubmit !== undefined &&
      tool.name !== testSubmit &&
      tool.name !== McpToolName.SubmitResult &&
      !BROWSER_TEST_TOOLS.includes(tool.name)
    ) {
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This browser test can only use its test tools');
    }
    if (!tool.allowedKinds.includes(attempt.kind)) {
      throw new AppError(ErrorCode.McpToolNotAllowed, `${tool.name} is not allowed in ${attempt.kind} attempts`, {
        kind: attempt.kind,
        allowedKinds: tool.allowedKinds,
      });
    }
    return attempt;
  }

  function errorResult(info: ErrorInfo, hint: string | undefined, guide?: unknown): CallToolResult {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...info, ...(guide ? { guide } : {}), ...(hint === undefined ? {} : { hint }) }),
        },
      ],
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

    async call(name, args, signal) {
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) {
        return errorResult({ code: ErrorCode.NotFound, message: `Unknown tool ${name}` }, undefined);
      }
      const { [MCP_SESSION_ARG]: sessionId, ...rest } = args;
      const owner = typeof sessionId === 'string' ? attempts.findLatestBySession(sessionId) : undefined;
      try {
        const attempt = resolveAttempt(tool, sessionId, owner);
        const parsed = tool.input.safeParse(rest);
        if (!parsed.success) {
          throw new AppError(ErrorCode.ValidationFailed, 'Tool arguments are invalid', { issues: parsed.error.issues });
        }
        const returned = await tool.handler(parsed.data, { attempt, signal });
        const output = tool.output.parse(returned);
        log.info({ tool: name, attemptId: attempt.id }, 'mcp tool called');
        // opencode hands images to models with image input and tells the others they cannot see them (29 §12 V4).
        const images = (returned[MCP_IMAGES] ?? []).map((image) => ({ type: 'image' as const, ...image }));
        return { content: [{ type: 'text', text: JSON.stringify(output) }, ...images], structuredContent: output };
      } catch (err) {
        if (err instanceof AppError) {
          log.info({ tool: name, code: err.code }, 'mcp tool failed');
          const info = err.toInfo();
          const guide =
            owner && (owner.status === AttemptStatus.Running || owner.status === AttemptStatus.Starting)
              ? rejectionGuide(owner, tool.name, rest, info)
              : undefined;
          const hint = tool.hints?.[err.code] ?? COMMON_HINTS[err.code];
          return errorResult(info, guide ? [guide.next, hint].filter(Boolean).join(' ') : hint, guide);
        }
        log.error({ err, tool: name }, 'mcp tool crashed');
        return errorResult({ code: ErrorCode.InternalError, message: 'Internal error' }, undefined);
      }
    },
  };
}
