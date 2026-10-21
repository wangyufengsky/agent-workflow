import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { type BackendShutdownMessage, DEV_API_PORT } from '@aw/shared';
import { app, utilityProcess } from 'electron';
import { serveCredentialRequests } from './credentials.ts';

/** `stop` asks the backend to shut down (it stops opencode first) and resolves once it has exited. */
export type Backend = { port: number; apiToken: string; stop(): Promise<void> };

/** Starts the backend in a utilityProcess and resolves once it is listening. */
export function startBackend(isDev: boolean): Promise<Backend> {
  const apiToken = randomBytes(32).toString('hex');
  const child = utilityProcess.fork(join(import.meta.dirname, 'server.js'), [], {
    serviceName: 'agent-workflow-backend',
    stdio: 'inherit',
    env: {
      ...process.env,
      AW_API_TOKEN: apiToken,
      AW_DATA_DIR: app.getPath('userData'),
      AW_PORT: String(isDev ? DEV_API_PORT : 0),
      AW_APP_VERSION: app.getVersion(),
      AW_MIGRATIONS_DIR: app.isPackaged
        ? join(process.resourcesPath, 'migrations')
        : join(app.getAppPath(), '../../packages/server/migrations'),
      AW_PROMPTS_DIR: app.isPackaged
        ? join(process.resourcesPath, 'prompts')
        : join(app.getAppPath(), '../../packages/builtin/prompts'),
      AW_OPENCODE_PLUGIN_FILE: app.isPackaged
        ? join(process.resourcesPath, 'opencode-plugin', 'agent-workflow-bridge.js')
        : join(app.getAppPath(), '../../packages/opencode-plugin/dist/agent-workflow-bridge.js'),
      ...(isDev ? {} : { AW_WEB_DIR: join(import.meta.dirname, '../renderer') }),
    },
  });
  serveCredentialRequests(child);

  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`Backend exited before it was ready (code ${code})`)));
    child.on('message', (message: { type: string; port: number }) => {
      if (message.type !== 'ready') return;
      child.removeAllListeners('exit');
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      const shutdown: BackendShutdownMessage = { type: 'backend.shutdown' };
      resolve({
        port: message.port,
        apiToken,
        stop: async () => {
          child.postMessage(shutdown);
          await exited;
        },
      });
    });
  });
}
