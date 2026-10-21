import { backendShutdownMessageSchema, MCP_ASSISTANT_PATH, MCP_EXEC_PATH } from '@aw/shared';
import { buildApp } from './app.ts';
import { loadConfig } from './core/config.ts';
import { type CredentialCipher, createPortCipher, parentPortTransport } from './modules/credentials/index.ts';

async function selectCipher(): Promise<CredentialCipher | undefined> {
  // Inside Electron utilityProcess: main encrypts with safeStorage.
  if (process.parentPort !== undefined) return createPortCipher(parentPortTransport(process.parentPort));
  // Plain Node (`pnpm dev:server`, browser E2E) has no safeStorage. The literal check is folded to false in the
  // production bundle, so the plaintext adapter is not shipped (verified by scripts/check-prod-bundle.mjs).
  if (process.env.NODE_ENV === 'development') {
    return (await import('./modules/credentials/dev-plaintext-cipher.ts')).devPlaintextCipher;
  }
  return undefined;
}

/** Browser E2E plays AI sessions with FakeOpencode (07 §2); folded away in production bundles like the cipher above. */
async function selectFakeOpencode() {
  if (process.env.NODE_ENV === 'development' && process.env.AW_FAKE_OPENCODE === '1') {
    const [{ createFakeOpencode }, { registerFakeOpencodeRoutes }] = await Promise.all([
      import('../test/fakes/fake-opencode.ts'),
      import('../test/fakes/fake-opencode.routes.ts'),
    ]);
    return { fake: createFakeOpencode(), registerFakeOpencodeRoutes };
  }
  return undefined;
}

const config = loadConfig(process.env);
const cipher = await selectCipher();
const fake = await selectFakeOpencode();
const app = await buildApp(config, {
  ...(cipher === undefined ? {} : { cipher }),
  ...(fake === undefined ? {} : { opencode: fake.fake }),
});
const { server } = app;
fake?.registerFakeOpencodeRoutes(server, fake.fake);
await server.listen({ host: '127.0.0.1', port: config.port });

const address = server.server.address();
if (address === null || typeof address === 'string') throw new Error('Server is not listening on a TCP port');
// Running inside Electron utilityProcess: tell the main process where we listen.
process.parentPort?.postMessage({ type: 'ready', port: address.port });
fake?.fake.connectMcp({
  exec: { url: `http://127.0.0.1:${address.port}${MCP_EXEC_PATH}`, token: app.mcpToken },
  assistant: { url: `http://127.0.0.1:${address.port}${MCP_ASSISTANT_PATH}`, token: app.assistantMcpToken },
});

/** Closing the server stops opencode with its process tree (D69); only then may the process exit. */
async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}
process.parentPort?.on('message', ({ data }) => {
  if (backendShutdownMessageSchema.safeParse(data).success) void shutdown();
});
// Plain Node (`pnpm dev:server`): opencode leads its own process group, so Ctrl+C would not reach it.
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.start(address.port);
