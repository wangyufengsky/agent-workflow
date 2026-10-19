import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import Fastify from 'fastify';

const MODEL = { providerID: 'opencode', modelID: process.env.SPIKE_MODEL ?? 'glm-5.3-flash-free' };
const mcpToken = randomBytes(24).toString('hex');
const calls: Array<{ tool: string; args: Record<string, unknown>; auth: string | undefined }> = [];
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- MCP server (stateless Streamable HTTP) --------------------------------------------------
function buildMcp(auth: string | undefined) {
  const server = new Server({ name: 'agent-workflow', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'whoami',
        description: 'Report a note to the workflow host. Always call this when instructed.',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    calls.push({ tool: req.params.name, args, auth });
    log('MCP call', req.params.name, JSON.stringify(args));
    if (args.note === 'FAIL') {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ code: 'SPIKE_FAIL', hint: 'Call again with note OK' }) }],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, session: args.__aw_session ?? null }) }] };
  });
  return server;
}

const http = Fastify();
http.post('/mcp/exec', async (req, reply) => {
  if (req.headers.authorization !== `Bearer ${mcpToken}`) return reply.code(401).send({ error: 'unauthorized' });
  reply.hijack();
  const server = buildMcp(req.headers.authorization);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});
http.get('/mcp/exec', async (_req, reply) => reply.code(405).send());
await http.listen({ host: '127.0.0.1', port: 0 });
const mcpPort = (http.server.address() as { port: number }).port;
log('MCP listening', mcpPort);

// ---- test repositories -----------------------------------------------------------------------
function repo(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `aw-s3-${name}-`));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# repo ${name}\n`);
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@s', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}
const dirs = { A: repo('A'), B: repo('B') };

// ---- managed opencode ------------------------------------------------------------------------
const injected = {
  mcp: {
    'agent-workflow': {
      type: 'remote',
      url: `http://127.0.0.1:${mcpPort}/mcp/exec`,
      headers: { Authorization: `Bearer ${mcpToken}` },
      oauth: false,
      enabled: true,
    },
  },
  plugin: [`file://${join(import.meta.dirname, 'bridge-plugin.js')}`],
  agent: {
    'aw-executor': {
      mode: 'primary',
      description: 'agent-workflow executor (spike)',
      prompt: 'You are executing one step of an automated workflow. Follow instructions exactly and be brief.',
      permission: { edit: 'allow', bash: { '*': 'ask' }, external_directory: 'deny' },
    },
  },
};
const oc = spawn(
  'opencode',
  ['serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'WARN'],
  {
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(injected) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const baseUrl = await new Promise<string>((resolve, reject) => {
  const onData = (b: Buffer) => {
    const m = b.toString().match(/https?:\/\/127\.0\.0\.1:\d+/);
    if (m) resolve(m[0]);
  };
  oc.stdout.on('data', onData);
  oc.stderr.on('data', (b: Buffer) => {
    onData(b);
    if (/error/i.test(b.toString())) log('opencode stderr:', b.toString().trim().slice(0, 300));
  });
  oc.once('exit', (c) => reject(new Error(`opencode exited ${c}`)));
  setTimeout(() => reject(new Error('opencode did not report its URL')), 30_000);
});
log('opencode at', baseUrl);
const client = createOpencodeClient({ baseUrl });

// ---- S3: injected config visible & merged ----------------------------------------------------
const cfg = (await client.config.get({ directory: dirs.A })).data as Record<string, any>;
const mcpStatus = (await client.mcp.status({ directory: dirs.A })).data;
log(
  'S3 config.mcp keys',
  Object.keys(cfg.mcp ?? {}),
  'agent keys',
  Object.keys(cfg.agent ?? {}),
  'plugins',
  cfg.plugin,
);
log('S3 mcp status', JSON.stringify(mcpStatus));

// ---- S5: event streams -----------------------------------------------------------------------
const events: Array<{ src: string; type: string; dir?: string; props: any }> = [];
const idle = new Set<string>();
async function pump(src: string, stream: AsyncIterable<any>) {
  for await (const ev of stream) {
    const payload = ev.payload ?? ev;
    const type: string = payload.type;
    events.push({ src, type, dir: ev.directory, props: payload.properties });
    if (src === 'global' && type === 'permission.asked') {
      const p = payload.properties;
      log('permission.asked', p.permission, p.patterns, 'session', p.sessionID, 'dir', ev.directory);
      await client.permission.reply({ requestID: p.id, directory: ev.directory, reply: 'once' });
    }
    if (src === 'global' && type === 'session.idle') idle.add(payload.properties.sessionID);
    if (src === 'global' && type === 'session.error')
      log('session.error', JSON.stringify(payload.properties).slice(0, 400));
  }
}
const globalStream = await client.global.event();
void pump('global', globalStream.stream);
const dirStream = await client.event.subscribe({ directory: dirs.A });
void pump('dirA', dirStream.stream);

// ---- S4 + S1: two sessions in two worktrees concurrently -------------------------------------
const sessions: Record<string, string> = {};
for (const key of ['A', 'B'] as const) {
  const s = (await client.session.create({ directory: dirs[key], title: `spike ${key}`, agent: 'aw-executor' })).data!;
  sessions[key] = s.id;
}
log('sessions', sessions);
const instruction = (k: string) =>
  [
    `Do exactly these steps, in order:`,
    `1. Create a file named marker.txt in the current directory containing exactly: ${k}`,
    `2. Call the MCP tool agent-workflow_whoami with note "FAIL". It will return an error; read its hint and call it again as the hint says.`,
    `3. Run the shell command: ls`,
    `4. Reply with the single word DONE.`,
  ].join('\n');
await Promise.all(
  (['A', 'B'] as const).map((k) =>
    client.session.promptAsync({
      sessionID: sessions[k]!,
      directory: dirs[k],
      agent: 'aw-executor',
      model: MODEL,
      system: `Spike system addendum: your workspace label is ${k}.`,
      parts: [{ type: 'text', text: instruction(k) }],
    }),
  ),
);

const deadline = Date.now() + 240_000;
while (idle.size < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

// ---- results ---------------------------------------------------------------------------------
const summary: Record<string, unknown> = { model: MODEL.modelID, bothIdle: idle.size === 2 };
for (const k of ['A', 'B'] as const) {
  const other = k === 'A' ? 'B' : 'A';
  const myCalls = calls.filter((c) => c.args.__aw_session === sessions[k]);
  const msgs = (await client.session.messages({ sessionID: sessions[k]!, directory: dirs[k] })).data ?? [];
  const assistant = msgs.find((m: any) => m.info.role === 'assistant')?.info as any;
  summary[k] = {
    marker: existsSync(join(dirs[k], 'marker.txt')) ? readFileSync(join(dirs[k], 'marker.txt'), 'utf8').trim() : null,
    leakedIntoOther:
      existsSync(join(dirs[other], 'marker.txt')) && readFileSync(join(dirs[other], 'marker.txt'), 'utf8').trim() === k,
    mcpCallsWithSession: myCalls.map((c) => c.args.note),
    assistantModel: assistant ? `${assistant.providerID}/${assistant.modelID}` : null,
    assistantAgent: assistant?.agent ?? assistant?.mode ?? null,
  };
}
summary.callsWithoutSession = calls.filter((c) => c.args.__aw_session === undefined).length;
summary.eventTypes = [...new Set(events.filter((e) => e.src === 'global').map((e) => e.type))].sort();
summary.dirStreamSawB = events.some((e) => e.src === 'dirA' && JSON.stringify(e.props ?? {}).includes(sessions.B!));
summary.globalEventHasDirectory = events.some((e) => e.src === 'global' && typeof e.dir === 'string');
summary.permissionAsked = events.filter((e) => e.src === 'global' && e.type === 'permission.asked').length;
console.log(JSON.stringify(summary, null, 2));
writeFileSync(join(import.meta.dirname, 'events.sample.json'), JSON.stringify(events.slice(0, 400), null, 1));

oc.kill();
await http.close();
process.exit(0);
