import { API_PREFIX } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { parseInput } from './errors.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({
    routes: (server) => {
      server.post(`${API_PREFIX}/__test/echo`, async (req) => parseInput(z.object({ n: z.number() }), req.body));
      server.get(`${API_PREFIX}/__test/boom`, async () => {
        throw new Error('kaboom');
      });
    },
  });
});
afterEach(() => t.close());

describe('令牌认证', () => {
  it('带正确令牌时返回健康状态', async () => {
    const res = await t.request({ url: '/system/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', node: process.versions.node });
  });

  it.each([
    ['缺少令牌', {}],
    ['令牌错误', { authorization: `Bearer ${'x'.repeat(64)}` }],
  ])('%s时返回 401 UNAUTHORIZED', async (_name, headers) => {
    const res = await t.app.server.inject({ url: `${API_PREFIX}/system/health`, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
  });

  it('普通接口不接受查询参数中的令牌', async () => {
    const res = await t.app.server.inject({ url: `${API_PREFIX}/system/health?token=${'t'.repeat(64)}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('统一错误出口', () => {
  it('校验失败返回 400 VALIDATION_FAILED 且 details 含 zod issues', async () => {
    const res = await t.request({ method: 'POST', url: '/__test/echo', payload: { n: 'one' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { issues: [expect.objectContaining({ path: ['n'] })] } },
    });
  });

  it('请求体不是合法 JSON 时返回 400 VALIDATION_FAILED', async () => {
    const res = await t.request({
      method: 'POST',
      url: '/__test/echo',
      payload: '{',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('未知异常返回 500 INTERNAL_ERROR，不泄漏消息，日志记录堆栈', async () => {
    const res = await t.request({ url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    const logged = t.logs.find((l) => l.msg === 'unhandled error');
    expect(logged?.err?.message).toBe('kaboom');
    expect(logged?.err?.stack).toContain('http.int.test.ts');
  });

  it('不存在的 API 路由返回 404 NOT_FOUND', async () => {
    const res = await t.request({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
