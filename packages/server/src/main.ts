import { buildApp } from './app.ts';
import { loadConfig } from './core/config.ts';

const config = loadConfig(process.env);
const { server } = await buildApp(config);
await server.listen({ host: '127.0.0.1', port: config.port });

const address = server.server.address();
if (address === null || typeof address === 'string') throw new Error('Server is not listening on a TCP port');
// Running inside Electron utilityProcess: tell the main process where we listen.
process.parentPort?.postMessage({ type: 'ready', port: address.port });
