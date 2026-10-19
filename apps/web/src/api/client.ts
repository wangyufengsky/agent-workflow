import { API_PREFIX } from '@aw/shared';

function apiToken(): string {
  if (window.aw !== undefined) return window.aw.apiToken;
  // Plain-browser development and E2E: the token is provided at build time by the dev script.
  const token = import.meta.env.VITE_AW_API_TOKEN;
  if (token === undefined) throw new Error('No API token: not running in Electron and VITE_AW_API_TOKEN is unset');
  return token;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, { headers: { Authorization: `Bearer ${apiToken()}` } });
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
