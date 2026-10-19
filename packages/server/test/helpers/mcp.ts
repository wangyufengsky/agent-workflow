import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/** MCP SDK client against the execution MCP, as opencode connects to it. */
export async function connectMcp(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'aw-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // The SDK's own transport type does not satisfy its Transport interface under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  return client;
}

export type ToolOutcome = { isError: boolean; body: Record<string, unknown> };

/** Calls a tool and parses the JSON text content of the result (12 §5). */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as Array<{ type: 'text'; text: string }>;
  if (first === undefined) throw new Error(`${name} returned no content`);
  return { isError: result.isError === true, body: JSON.parse(first.text) };
}
