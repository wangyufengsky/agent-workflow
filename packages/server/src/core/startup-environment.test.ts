import { Platform } from '@aw/shared';
import { expect, it } from 'vitest';
import { applyStartupEnvironment, scopedStartupEnvironment } from './startup-environment.ts';

it('replaces all Windows spellings of changed names and suppresses inherited copies of deferred secrets', () => {
  const shell = {
    Path: 'system',
    path: 'duplicate',
    Example_Key: 'inherited',
    example_key: 'duplicate',
    OTHER: 'kept',
  };
  const env = scopedStartupEnvironment(shell);
  applyStartupEnvironment(env, { PATH: 'saved' }, ['EXAMPLE_KEY'], Platform.Win32);
  expect(env).toEqual({ PATH: 'saved', OTHER: 'kept' });
  applyStartupEnvironment(env, { EXAMPLE_KEY: 'unlocked' }, [], Platform.Win32);
  expect(env).toEqual({ PATH: 'saved', EXAMPLE_KEY: 'unlocked', OTHER: 'kept' });
  expect(shell).toMatchObject({ Path: 'system', Example_Key: 'inherited' });
});

it('does not fold unrelated Unix environment variable spellings', () => {
  const env = scopedStartupEnvironment({ Path: 'legacy', PATH: 'system', Example_Key: 'other' });
  applyStartupEnvironment(env, { PATH: 'saved' }, ['EXAMPLE_KEY'], Platform.Linux);
  expect(env).toEqual({ Path: 'legacy', PATH: 'saved', Example_Key: 'other' });
});
