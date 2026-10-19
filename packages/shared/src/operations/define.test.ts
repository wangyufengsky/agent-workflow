import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineOperationContract } from './define.ts';

const base = {
  id: 'things.create',
  title: 'op.things.create',
  description: 'Create a thing',
  input: z.object({ name: z.string(), token: z.string() }),
  output: z.object({ id: z.string() }),
  http: { method: 'POST', path: '/things' },
  expose: { palette: false, assistant: true },
  mode: 'simple',
} as const;

// These assertions are enforced by `pnpm typecheck` (tsc fails when an expected error disappears).
describe('defineOperationContract', () => {
  it('risk 与 credentialFields 必须声明，凭据字段只能是输入字段', () => {
    // @ts-expect-error risk is required
    defineOperationContract({ ...base, credentialFields: [] });
    // @ts-expect-error credentialFields is required
    defineOperationContract({ ...base, risk: 'write' });
    // @ts-expect-error credentialFields must name input fields
    defineOperationContract({ ...base, risk: 'write', credentialFields: ['password'] });

    const op = defineOperationContract({ ...base, risk: 'write', credentialFields: ['token'] });
    expect(op.credentialFields).toEqual(['token']);
  });
});
