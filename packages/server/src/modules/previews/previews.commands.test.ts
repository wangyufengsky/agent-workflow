import { ErrorCode, Platform } from '@aw/shared';
import { expect, it } from 'vitest';
import { host } from '../../core/platform.ts';
import { javaBuildExecutable } from './previews.commands.ts';

it.each([
  ['maven', host.os === Platform.Win32 ? 'mvnw.cmd' : 'mvnw'],
  ['gradle', host.os === Platform.Win32 ? 'gradlew.bat' : 'gradlew'],
] as const)('uses a committed ancestor %s wrapper without a build tool on PATH', async (manager, wrapper) => {
  const checked: string[] = [];
  const committed = async (relative: string) => {
    checked.push(relative);
    return relative === wrapper ? { absolute: process.execPath, size: 1 } : undefined;
  };

  await expect(javaBuildExecutable(manager, 'packages/service', committed, {})).resolves.toBe(process.execPath);
  expect(checked).toEqual([`packages/service/${wrapper}`, `packages/${wrapper}`, wrapper]);
});

it('uses the nearest committed wrapper before consulting the repository root', async () => {
  const wrapper = host.os === Platform.Win32 ? 'mvnw.cmd' : 'mvnw';
  const checked: string[] = [];
  const committed = async (relative: string) => {
    checked.push(relative);
    return relative === `packages/${wrapper}` ? { absolute: process.execPath, size: 1 } : undefined;
  };
  await expect(javaBuildExecutable('maven', 'packages/service', committed, {})).resolves.toBe(process.execPath);
  expect(checked).toEqual([`packages/service/${wrapper}`, `packages/${wrapper}`]);
  await expect(javaBuildExecutable('maven', '.', async () => undefined, {})).rejects.toMatchObject({
    code: ErrorCode.PreviewStartFailed,
  });
});
