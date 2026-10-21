import { devPorts } from '@aw/shared';

// `pnpm dev:server`: the backend on the development port, where `pnpm dev:web` proxies the API (D78).
process.env.AW_PORT = String(devPorts(process.env).api);
await import('./main.ts');
