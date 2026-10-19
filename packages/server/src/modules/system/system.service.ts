import { AppError, type EnvironmentDTO, ErrorCode, type Health, RuntimeStatus } from '@aw/shared';
import type { AppConfig } from '../../core/config.ts';
import { readGitVersion } from '../git/index.ts';
import type { OpencodeClient, OpencodeRuntime } from '../opencode/index.ts';

export type SystemServiceDeps = {
  config: AppConfig;
  env: NodeJS.ProcessEnv;
  runtime: OpencodeRuntime;
  opencode: OpencodeClient;
};

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

export function createSystemService({ config, env, runtime, opencode }: SystemServiceDeps) {
  async function environment(): Promise<EnvironmentDTO> {
    const runtimeState = await runtime.snapshot();
    const git = await detectGit(env);
    // Models are only known while opencode runs; the renderer refetches on runtime.updated.
    const models = opencode.isConnected() ? await opencode.listModels() : { available: [] };
    return {
      git,
      opencode: runtimeState,
      models,
      // TODO(M2-10): also require a model once browser E2E runs against FakeOpencode.
      ready: git.installed && !NOT_HOSTABLE.includes(runtimeState.status),
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
