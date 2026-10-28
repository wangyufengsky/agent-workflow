import {
  AppError,
  type EnvironmentDTO,
  ErrorCode,
  type Health,
  isSupportedGitVersion,
  type ModelInfo,
  RuntimeStatus,
} from '@aw/shared';
import type { AppConfig } from '../../core/config.ts';
import { host } from '../../core/platform.ts';
import type { CredentialsService } from '../credentials/index.ts';
import { locateShell, readGitVersion } from '../git/index.ts';
import type { OpencodeClient, OpencodeRuntime } from '../opencode/index.ts';
import type { ProjectsService } from '../projects/index.ts';

export type SystemServiceDeps = {
  config: AppConfig;
  env: NodeJS.ProcessEnv;
  runtime: OpencodeRuntime;
  opencode: OpencodeClient;
  credentials: CredentialsService;
  projects: Pick<ProjectsService, 'list'>;
  /** Starts the hosted runtime if it is stopped or crashed (and hosting has begun, see app.ts). */
  startRuntime: () => Promise<void>;
};

const NOT_HOSTABLE: readonly RuntimeStatus[] = [RuntimeStatus.NotInstalled, RuntimeStatus.VersionMismatch];

async function detectGit(env: NodeJS.ProcessEnv): Promise<EnvironmentDTO['git']> {
  try {
    const version = await readGitVersion(env);
    // On Windows commands run in the bash that comes with Git for Windows: a git without it is not enough (D72).
    await locateShell(env);
    return { installed: true, version, supported: isSupportedGitVersion(version) };
  } catch (err) {
    // Recovery with a defined meaning: a missing git is a check result shown on onboarding, not a failure.
    if (err instanceof AppError && err.code === ErrorCode.GitNotInstalled) return { installed: false };
    throw err;
  }
}

const modelKey = (m: { providerId: string; modelId: string }) => `${m.providerId}/${m.modelId}`;

export function createSystemService({
  config,
  env,
  runtime,
  opencode,
  credentials,
  projects,
  startRuntime,
}: SystemServiceDeps) {
  /**
   * The global configuration's models, then those only a project's own opencode configuration provides (an intranet
   * provider committed to the repository), with the projects that have them (D162).
   */
  async function listModels(): Promise<EnvironmentDTO['models']> {
    const [global, ofProjects] = await Promise.all([
      opencode.listModels(),
      Promise.all(projects.list().map(async (p) => ({ projectId: p.id, ...(await opencode.listModels(p.repoPath)) }))),
    ]);
    const models = new Map<string, ModelInfo>(global.available.map((m) => [modelKey(m), { ...m, projectIds: [] }]));
    for (const { projectId, available } of ofProjects) {
      for (const m of available) {
        const known = models.get(modelKey(m));
        if (known === undefined) models.set(modelKey(m), { ...m, projectIds: [projectId] });
        else if (known.projectIds.length > 0) known.projectIds.push(projectId);
      }
    }
    const available = [...models.values()];
    return global.defaultModel === undefined ? { available } : { available, defaultModel: global.defaultModel };
  }

  async function environment(): Promise<EnvironmentDTO> {
    const runtimeState = await runtime.snapshot();
    const git = await detectGit(env);
    // Models are only known while opencode runs; the renderer refetches on runtime.updated.
    const models = opencode.isConnected() ? await listModels() : { available: [] };
    return {
      platform: host.os,
      git,
      opencode: runtimeState,
      models,
      credentials: await credentials.status(),
      ready:
        git.installed && git.supported && !NOT_HOSTABLE.includes(runtimeState.status) && models.available.length > 0,
    };
  }

  return {
    health: (): Health => ({ status: 'ok', appVersion: config.appVersion, node: process.versions.node }),
    environment,
    /**
     * After installing opencode (or choosing its path) the runtime becomes `stopped`: start it right away. A crashed
     * runtime is started again too: what made it fail may be fixed now (Git Bash installed on Windows, D72).
     */
    async recheck(): Promise<EnvironmentDTO> {
      await runtime.recheck();
      await startRuntime();
      return environment();
    },
    runtime: () => runtime.snapshot(),
    restartRuntime: () => runtime.restart(),
    runtimeLogs: (tail: number) => runtime.logTail(tail),
  };
}
export type SystemService = ReturnType<typeof createSystemService>;
