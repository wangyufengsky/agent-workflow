import { devPorts } from '@aw/shared';

/** Shared by e2e/global-setup.ts (backend env) and specs (direct API calls). */
export const E2E_TOKEN = 'e2e'.padEnd(64, '0');
/** In workers, the port the backend reported to global setup (D78). */
export const API_BASE = `http://127.0.0.1:${devPorts(process.env).api}/api/v1`;
export const AUTH = { Authorization: `Bearer ${E2E_TOKEN}` };
