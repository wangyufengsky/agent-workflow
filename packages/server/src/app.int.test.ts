import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_PREFIX } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './core/config.ts';

const TOKEN = 'b'.repeat(64);
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'aw-int-'));
  app = await buildApp(loadConfig({ AW_API_TOKEN: TOKEN, AW_DATA_DIR: dataDir, AW_LOG_LEVEL: 'error' }));
});
afterAll(() => app.close());

describe('API 认证', () => {
  it('带正确令牌时返回健康状态', async () => {
    const res = await app.inject({ url: `${API_PREFIX}/system/health`, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', node: process.versions.node });
  });

  it('缺少令牌时返回 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ url: `${API_PREFIX}/system/health` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
  });
});
