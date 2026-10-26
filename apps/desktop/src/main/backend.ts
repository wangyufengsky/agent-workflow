import { userInfo } from 'node:os';
import { join } from 'node:path';
import { type BackendShutdownMessage, devPorts, platformSchema } from '@aw/shared';
import { app, utilityProcess } from 'electron';
import { type BrowserTabs, type BrowserTabsDeps, serveBrowserRequests } from './browser.ts';
import { serveCredentialRequests } from './credentials.ts';
import { withLoginShellEnv } from './shell-path.ts';

/** `stop` asks the backend to shut down (it stops opencode first) and resolves once it has exited. */
export type Backend = { port: number; browser: BrowserTabs; stop(): Promise<void> };

/**
 * Starts the backend in a utilityProcess and resolves once it is listening. The window already has `apiToken`: it is
 * created first, to show the opening animation while this runs (28 §5.2). The backend gets the login shell's PATH
 * (D117): started from Finder the app has only the system directories.
 */
export async function startBackend(
  isDev: boolean,
  apiToken: string,
  browser: Omit<BrowserTabsDeps, 'emit'>,
): Promise<Backend> {
  // `shell` is null only on Windows, which has no login shell to ask.
  const env = await withLoginShellEnv(platformSchema.parse(process.platform), process.env, userInfo().shell ?? '');
  const child = utilityProcess.fork(join(import.meta.dirname, 'server.js'), [], {
    serviceName: 'agent-workflow-backend',
    stdio: 'inherit',
    env: {
      ...env,
      AW_API_TOKEN: apiToken,
      AW_DATA_DIR: app.getPath('userData'),
      AW_PORT: String(isDev ? devPorts(process.env).api : 0),
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
      // Built next to server.js, in development too.
      AW_OFFICE_WORKER_FILE: join(import.meta.dirname, 'office-worker.js'),
      ...(isDev ? {} : { AW_WEB_DIR: join(import.meta.dirname, '../renderer') }),
    },
  });
  serveCredentialRequests(child);
  const tabs = serveBrowserRequests(child, browser);

  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`Backend exited before it was ready (code ${code})`)));
    child.on('message', (message: { type: string; port: number }) => {
      if (message.type !== 'ready') return;
      child.removeAllListeners('exit');
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      const shutdown: BackendShutdownMessage = { type: 'backend.shutdown' };
      resolve({
        port: message.port,
        browser: tabs,
        stop: async () => {
          child.postMessage(shutdown);
          await exited;
        },
      });
    });
  });
}
