import { API_PREFIX, defineOperationContract, OperationRisk, UiMode } from '@aw/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerErrorHandling } from '../http/errors.ts';
import { implement, mountOperations } from './operations.ts';

const thing = z.object({ id: z.string(), name: z.string() });
const common = { credentialFields: [], mode: UiMode.Simple, description: 'test' } as const;

const getThingOp = defineOperationContract({
  ...common,
  id: 'things.get',
  title: 'op.things.get',
  input: z.object({ id: z.string() }),
  output: thing,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/things/:id' },
  expose: { palette: true, assistant: true },
});
const createThingOp = defineOperationContract({
  ...common,
  id: 'things.create',
  title: 'op.things.create',
  input: z.object({ name: z.string().min(1) }),
  output: thing,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/things', status: 201 },
  expose: { palette: false, assistant: true },
});
const deleteThingOp = defineOperationContract({
  ...common,
  id: 'things.delete',
  title: 'op.things.delete',
  input: z.object({ id: z.string() }),
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/things/:id' },
  expose: { palette: true, assistant: true },
});

let server: FastifyInstance;
const deleted: string[] = [];
beforeEach(() => {
  server = Fastify();
  registerErrorHandling(server, { serveSpa: false });
  mountOperations(server, [
    // The handler returns an extra field; the output schema must strip it.
    implement(getThingOp, ({ id }) => ({ id, name: `thing ${id}`, secret: 'x' })),
    implement(createThingOp, ({ name }) => ({ id: 'new', name })),
    implement(deleteThingOp, ({ id }) => void deleted.push(id)),
  ]);
});
afterEach(() => server.close());

describe('操作清单挂载', () => {
  it('操作挂载为路由，路径参数进入输入，输出按 schema 剥离多余字段', async () => {
    const res = await server.inject({ url: `${API_PREFIX}/things/42` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: '42', name: 'thing 42' });
  });

  it('创建操作按声明返回 201，请求体进入输入', async () => {
    const res = await server.inject({ method: 'POST', url: `${API_PREFIX}/things`, payload: { name: 'a' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'new', name: 'a' });
  });

  it('输出为 void 的操作返回 204', async () => {
    const res = await server.inject({ method: 'DELETE', url: `${API_PREFIX}/things/7` });
    expect(res.statusCode).toBe(204);
    expect(deleted).toContain('7');
  });

  it('输入不符合 schema 时返回 400 VALIDATION_FAILED', async () => {
    const res = await server.inject({ method: 'POST', url: `${API_PREFIX}/things`, payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: ['name'] }] } },
    });
  });

  it('GET /operations?expose=palette 只返回进入命令面板且非 critical 的操作', async () => {
    const res = await server.inject({ url: `${API_PREFIX}/operations?expose=palette` });
    expect(res.json().items.map((o: { id: string }) => o.id)).toEqual(['things.get']);
  });

  it('GET /operations 返回全部操作及输入 JSON Schema', async () => {
    const res = await server.inject({ url: `${API_PREFIX}/operations` });
    expect(res.json().items).toHaveLength(3);
    expect(res.json().items[1]).toMatchObject({
      id: 'things.create',
      risk: 'write',
      method: 'POST',
      path: '/things',
      inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } } },
    });
  });
});
