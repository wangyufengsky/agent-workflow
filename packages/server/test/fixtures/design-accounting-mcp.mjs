// 真实 stdio MCP。回执仅由工具处理器生成，序号用来检查遗漏或重复的调用。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'design-accounting-test', version: '1' });
let receipt = 0;
for (const name of ['story_start', 'story_complete', 'lookup', 'blocked']) {
  server.registerTool(
    name,
    { inputSchema: name === 'story_start' ? { ipmpSystemCode: z.string(), storyCode: z.string() } : {} },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ name, ...args, receipt: ++receipt }) }],
    }),
  );
}
await server.connect(new StdioServerTransport());
