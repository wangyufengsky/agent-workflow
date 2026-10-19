import { OPERATION_CONTRACTS } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers/app.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('应用组装', () => {
  it('shared 中的每个操作契约都已实现并挂载', async () => {
    const res = await t.request({ url: '/operations' });
    const mounted = res.json().items.map((o: { id: string }) => o.id);
    expect(mounted.sort()).toEqual(OPERATION_CONTRACTS.map((c) => c.id).sort());
  });
});
