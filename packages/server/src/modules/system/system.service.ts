import {
  AppError,
  type EnvironmentDTO,
  ErrorCode,
  type Health,
  OPENCODE_VERSION,
  RuntimeEvent,
  RuntimeStatus,
  runtimeMachine,
  transition,
} from '@aw/shared';
import type { AppConfig } from '../../core/config.ts';
import { readGitVersion } from '../git/index.ts';
import { detectOpencode, type OpencodeDetection } from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';

export type SystemServiceDeps = { config: AppConfig; env: NodeJS.ProcessEnv; settings: SettingsService };

const NOT_HOSTABLE: readonly RuntimeStatus[] = [RuntimeStatus.NotInstalled, RuntimeStatus.VersionMismatch];

async function detectGit(env: NodeJS.ProcessEnv): Promise<EnvironmentDTO['git']> {
  try {
    return { installed: true, version: await readGitVersion(env) };
  } catch (err) {
    // Recovery with a defined meaning: a missing git is a check result shown on onboarding, not a failure.
    if (err instanceof AppError && err.code === ErrorCode.GitNotInstalled) return { installed: false };
    throw err;
  }
}

export function createSystemService({ config, env, settings }: SystemServiceDeps) {
  let opencode: OpencodeDetection | undefined;

  const detect = () => detectOpencode(env, settings.get('opencode.binaryPath'));

  async function environment(): Promise<EnvironmentDTO> {
    opencode ??= await detect();
    const git = await detectGit(env);
    return {
      git,
      opencode: { ...opencode, requiredVersion: OPENCODE_VERSION },
      // TODO(M2-04): provider list from the hosted runtime; until then onboarding does not require a model.
      models: { available: [] },
      ready: git.installed && !NOT_HOSTABLE.includes(opencode.status),
    };
  }

  return {
    health: (): Health => ({ status: 'ok', appVersion: config.appVersion, node: process.versions.node }),
    environment,
    /** Re-detects opencode while it is not hostable (runtime `recheck`, 09 §9); a hostable runtime is left alone. */
    async recheck(): Promise<EnvironmentDTO> {
      if (opencode === undefined || NOT_HOSTABLE.includes(opencode.status)) {
        const detected = await detect();
        if (opencode !== undefined) transition(runtimeMachine, opencode.status, RuntimeEvent.Recheck, detected.status);
        opencode = detected;
      }
      return environment();
    },
  };
}
export type SystemService = ReturnType<typeof createSystemService>;
