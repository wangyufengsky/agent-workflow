import { getSettingsOp, SETTING_DEFAULTS, type ServerEvent, updateSettingsOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';

let t: TestApp;
let published: ServerEvent[];
beforeEach(async () => {
  t = await createTestApp();
  published = [];
  t.app.events.subscribe((e) => published.push(e));
});
afterEach(() => t.close());

describe('设置 API', () => {
  it('未修改过时返回全部默认值', async () => {
    const res = await t.call(getSettingsOp, {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SETTING_DEFAULTS);
  });

  it('部分更新后返回并持久化合并结果，发出 settings.updated', async () => {
    const res = await t.call(updateSettingsOp, { 'ui.theme': 'claude_code', 'scheduler.maxConcurrentAttempts': 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      'ui.theme': 'claude_code',
      'scheduler.maxConcurrentAttempts': 2,
      'ui.mode': 'simple',
    });
    expect((await t.call(getSettingsOp, {})).body['ui.theme']).toBe('claude_code');
    expect(published).toEqual([
      { type: 'settings.updated', data: { keys: ['ui.theme', 'scheduler.maxConcurrentAttempts'] } },
    ]);
  });

  it('可空设置可以改回 null', async () => {
    await t.call(updateSettingsOp, { 'ai.defaultModel': 'opencode/glm' });
    const res = await t.call(updateSettingsOp, { 'ai.defaultModel': null });
    expect(res.body['ai.defaultModel']).toBeNull();
  });

  it('未知设置键返回 400 VALIDATION_FAILED', async () => {
    const res = await t.request({ method: 'PATCH', url: '/settings', payload: { 'ui.colour': 'red' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { issues: [{ code: 'unrecognized_keys' }] } },
    });
    expect(published).toEqual([]);
  });

  it('值类型错误返回 400 VALIDATION_FAILED 且不写入', async () => {
    const res = await t.request({
      method: 'PATCH',
      url: '/settings',
      payload: { 'ui.theme': 'pink', 'ui.mode': 'pro' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { details: { issues: [{ path: ['ui.theme'] }] } } });
    expect((await t.call(getSettingsOp, {})).body['ui.mode']).toBe('simple');
  });
});
