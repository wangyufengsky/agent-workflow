import { timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode } from '@aw/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** What an MCP endpoint serves: `tools/list` and `tools/call`. */
export type McpTools = {
  list(): Tool[];
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
};

function hasToken(req: FastifyRequest, token: string): boolean {
  const presented = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * An MCP endpoint (`/mcp/exec` 12 §7, `/mcp/assistant` 15 §2): stateless Streamable HTTP, one MCP server per
 * request, guarded by its own per-launch token (separate from the renderer token, D25). Only POST is served; there
 * is no session to resume.
 */
export function registerMcpEndpoint(
  server: FastifyInstance,
  options: { path: string; name: string; token: string; tools: McpTools },
): void {
  const { path, name, token, tools } = options;

  server.post(path, async (req, reply) => {
    if (!hasToken(req, token)) throw new AppError(ErrorCode.Unauthorized, 'Missing or invalid MCP token');
    const mcp = new Server({ name, version: '1' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.list() }));
    mcp.setRequestHandler(CallToolRequestSchema, (request) =>
      tools.call(request.params.name, request.params.arguments ?? {}),
    );
    // No session id generator: stateless mode.
    const transport = new StreamableHTTPServerTransport({});
    reply.hijack();
    reply.raw.on('close', () => void mcp.close());
    // The SDK's own transport type does not satisfy its Transport interface under exactOptionalPropertyTypes.
    await mcp.connect(transport as Transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = async (_req: FastifyRequest, reply: { code(n: number): { send(): unknown } }) =>
    reply.code(405).send();
  server.get(path, notAllowed);
  server.delete(path, notAllowed);
}
