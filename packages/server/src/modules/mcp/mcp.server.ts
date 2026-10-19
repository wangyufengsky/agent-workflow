import { timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode, MCP_EXEC_PATH, MCP_SERVER_NAME } from '@aw/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ToolRegistry } from './mcp.registry.ts';

function hasToken(req: FastifyRequest, token: string): boolean {
  const presented = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * Execution MCP at `/mcp/exec` (12 §7): stateless Streamable HTTP, one MCP server per request, guarded by the
 * per-launch MCP token (separate from the renderer token, D25). Only POST is served; there is no session to resume.
 */
export function registerMcpServer(server: FastifyInstance, options: { token: string; registry: ToolRegistry }): void {
  const { token, registry } = options;

  server.post(MCP_EXEC_PATH, async (req, reply) => {
    if (!hasToken(req, token)) throw new AppError(ErrorCode.Unauthorized, 'Missing or invalid MCP token');
    const mcp = new Server({ name: MCP_SERVER_NAME, version: '1' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: registry.list() }));
    mcp.setRequestHandler(CallToolRequestSchema, (request) =>
      registry.call(request.params.name, request.params.arguments ?? {}),
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
  server.get(MCP_EXEC_PATH, notAllowed);
  server.delete(MCP_EXEC_PATH, notAllowed);
}
