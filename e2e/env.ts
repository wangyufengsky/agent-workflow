import { DEV_API_PORT } from '@aw/shared';

/** Shared by playwright.config.ts (backend env) and specs (direct API calls). */
export const E2E_TOKEN = 'e2e'.padEnd(64, '0');
export const API_BASE = `http://127.0.0.1:${DEV_API_PORT}/api/v1`;
export const AUTH = { Authorization: `Bearer ${E2E_TOKEN}` };
