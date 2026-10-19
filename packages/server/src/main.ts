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

const config = loadConfig(process.env);
const cipher = await selectCipher();
const app = await buildApp(config, cipher === undefined ? {} : { cipher });
const { server } = app;
await server.listen({ host: '127.0.0.1', port: config.port });

const address = server.server.address();
if (address === null || typeof address === 'string') throw new Error('Server is not listening on a TCP port');
// Running inside Electron utilityProcess: tell the main process where we listen.
process.parentPort?.postMessage({ type: 'ready', port: address.port });
await app.startRuntime(address.port);
