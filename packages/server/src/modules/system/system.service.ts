import { AppError, type EnvironmentDTO, ErrorCode, type Health, RuntimeStatus } from '@aw/shared';
import type { AppConfig } from '../../core/config.ts';
import { readGitVersion } from '../git/index.ts';
import type { OpencodeRuntime } from '../opencode/index.ts';

export type SystemServiceDeps = { config: AppConfig; env: NodeJS.ProcessEnv; runtime: OpencodeRuntime };

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

export function createSystemService({ config, env, runtime }: SystemServiceDeps) {
  async function environment(): Promise<EnvironmentDTO> {
    const opencode = await runtime.snapshot();
    const git = await detectGit(env);
    return {
      git,
      opencode,
      // TODO(M2-04): provider list from the hosted runtime; until then onboarding does not require a model.
      models: { available: [] },
      ready: git.installed && !NOT_HOSTABLE.includes(opencode.status),
    };
  }

  return {
    health: (): Health => ({ status: 'ok', appVersion: config.appVersion, node: process.versions.node }),
    environment,
    async recheck(): Promise<EnvironmentDTO> {
      await runtime.recheck();
      return environment();
    },
    runtime: () => runtime.snapshot(),
    restartRuntime: () => runtime.restart(),
  };
}
export type SystemService = ReturnType<typeof createSystemService>;
