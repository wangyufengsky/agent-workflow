import { join } from 'node:path';
import {
  AppError,
  ErrorCode,
  type FunctionalTestServicePlan,
  type FunctionalTestServiceRuntime,
  isTerminalState,
  PREVIEW_LOG_TAIL_CHARS,
  type ProjectJavaModule,
  type ProjectModuleCheck,
  type ProjectModuleConfiguration,
  type ProjectModuleRun,
  ProjectModuleRunEvent,
  projectModuleRunInitialStatus,
  projectModuleRunMachine,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import { locateShell, type RepoLocks } from '../git/index.ts';
import { createProjectLog, projectLaunchEnvironment, setUpPreview, startServiceGroup } from '../previews/index.ts';
import { runtimeCheckCommands } from './runtime-checks.ts';
import { createRuntimeWorktree, recoverRuntimeWorktrees } from './runtime-worktree.ts';

const TRIAL_TIMEOUT_MS = 10 * 60_000;

type StartTrial = {
  repoPath: string;
  run: ProjectModuleRun;
} & (
  | { module: ProjectJavaModule; configuration?: ProjectModuleConfiguration; checks: ProjectModuleCheck[] }
  | { compoundPlan: FunctionalTestServicePlan }
);

type Trial = {
  run: ProjectModuleRun;
  output: ReturnType<typeof createProjectLog>;
  abort: AbortController;
  done: Promise<void>;
  readServices?: () => FunctionalTestServiceRuntime[];
};

type RuntimeDeps = {
  clock: Clock;
  env: NodeJS.ProcessEnv;
  locks: RepoLocks;
  dataDir: string;
  log: Logger;
  onUpdate(run: ProjectModuleRun, event: ProjectModuleRunEvent): void;
};

export function createModuleRuntime({ clock, env, locks, dataDir, log, onUpdate }: RuntimeDeps) {
  const root = join(dataDir, 'module-trials');
  const childEnv = projectLaunchEnvironment(env);
  const active = new Map<string, Trial>();
  let closing = false;
  const snapshot = (trial: Trial): ProjectModuleRun => {
    const services = trial.readServices?.() ?? trial.run.services;
    const targetLog = services?.find(({ id }) => id === trial.run.targetServiceId)?.logTail;
    return {
      ...trial.run,
      ...(services === undefined ? {} : { services }),
      log: `${targetLog ?? ''}${trial.output.tail()}`.slice(-PREVIEW_LOG_TAIL_CHARS),
    };
  };
  function move(trial: Trial, event: ProjectModuleRunEvent) {
    trial.run.status = transition(projectModuleRunMachine, trial.run.status, event);
    if (isTerminalState(projectModuleRunMachine, trial.run.status)) {
      trial.run.finishedAt = clock.now();
      trial.output.flush();
    }
    try {
      onUpdate(snapshot(trial), event);
    } catch (error) {
      log.error({ err: error, runId: trial.run.id }, 'module trial update failed');
    }
  }

  async function execute(trial: Trial, input: StartTrial) {
    const signal = trial.abort.signal;
    const cancelTimeout = clock.schedule(TRIAL_TIMEOUT_MS, () => {
      trial.output.append('Module trial reached its time limit.\n');
      trial.abort.abort(ProjectModuleRunEvent.Interrupt);
    });
    let worktree: Awaited<ReturnType<typeof createRuntimeWorktree>> | undefined;
    let outcome: ProjectModuleRunEvent = ProjectModuleRunEvent.Fail;
    try {
      signal.throwIfAborted();
      worktree = await createRuntimeWorktree(root, input.repoPath, trial.run.baseline, locks);
      signal.throwIfAborted();
      if ('checks' in input && trial.run.kind === 'checks') {
        const shell = await locateShell(childEnv);
        const commands = await runtimeCheckCommands(worktree, input.module, input.checks, childEnv);
        for (const command of commands) {
          await setUpPreview(command, {
            config: { readyPath: '/', command: () => command },
            directory: worktree.path,
            shell,
            clock,
            log: trial.output,
            signal,
            env: { ...childEnv, CI: 'true' },
          });
        }
        outcome = ProjectModuleRunEvent.Pass;
      } else {
        let plan: FunctionalTestServicePlan;
        if ('compoundPlan' in input) {
          plan = input.compoundPlan;
        } else {
          const proposal = input.configuration?.launch;
          if (proposal == null)
            throw new AppError(ErrorCode.ValidationFailed, 'The module configuration has no supported launch');
          plan = {
            services: [
              {
                id: input.module.id,
                moduleId: input.module.id,
                name: input.module.name,
                launch: proposal,
                dependsOn: [],
                inject: [],
              },
            ],
            targetServiceId: input.module.id,
          };
        }
        const group = await startServiceGroup({
          worktree,
          plan,
          env: childEnv,
          clock,
          signal,
          update(services) {
            trial.run.services = services;
            trial.run.targetServiceId = plan.targetServiceId;
            const target = services.find(({ id }) => id === plan.targetServiceId);
            trial.run.readyUrl = target?.readyUrl ?? null;
            trial.run.readyStatus = target?.readyStatus ?? null;
          },
        });
        trial.readServices = group.snapshot;
        try {
          if (!group.signal.aborted) move(trial, ProjectModuleRunEvent.Ready);
          await group.exited;
          if (!signal.aborted) throw group.failure() ?? new Error('The module service group exited');
        } finally {
          await group.stop();
        }
      }
    } catch (error) {
      if (!signal.aborted) trial.output.append(`${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      cancelTimeout();
      try {
        await worktree?.remove();
      } catch (error) {
        outcome = ProjectModuleRunEvent.Fail;
        trial.output.append('The detached module checkout could not be removed.\n');
        log.warn({ err: error, runId: trial.run.id }, 'module trial checkout removal failed');
      }
      if (signal.aborted)
        outcome =
          signal.reason === ProjectModuleRunEvent.Stop ? ProjectModuleRunEvent.Stop : ProjectModuleRunEvent.Interrupt;
      move(trial, outcome);
      trial.output.close();
      active.delete(trial.run.projectId);
    }
  }

  return {
    recover: () => recoverRuntimeWorktrees(root, locks, log),
    start(input: StartTrial): void {
      const { run } = input;
      if (run.status !== projectModuleRunInitialStatus[run.kind] || run.finishedAt !== null)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'A module run must begin in its initial state');
      if (closing || active.has(run.projectId))
        throw new AppError(
          ErrorCode.StateTransitionInvalid,
          'A module trial is already running or the service is closing',
        );
      if (
        'compoundPlan' in input
          ? run.kind !== 'launch'
          : (run.kind === 'launch' && input.configuration?.launch == null) ||
            (run.kind === 'checks' && input.checks.length === 0)
      )
        throw new AppError(ErrorCode.ValidationFailed, 'Choose a runnable module configuration or discovered checks');
      const trial: Trial = {
        run: { ...run },
        abort: new AbortController(),
        output: createProjectLog(env),
        done: Promise.resolve(),
      };
      active.set(run.projectId, trial);
      trial.done = execute(trial, input);
    },
    get(projectId: string): ProjectModuleRun | undefined {
      const trial = active.get(projectId);
      return trial === undefined ? undefined : snapshot(trial);
    },
    async stop(projectId: string, runId: string): Promise<void> {
      const trial = active.get(projectId);
      if (trial?.run.id !== runId) return;
      trial.abort.abort(ProjectModuleRunEvent.Stop);
      await trial.done;
    },
    abortProject(projectId: string): void {
      active.get(projectId)?.abort.abort(ProjectModuleRunEvent.Interrupt);
    },
    async stopAll(): Promise<void> {
      closing = true;
      const trials = [...active.values()];
      for (const trial of trials) trial.abort.abort(ProjectModuleRunEvent.Interrupt);
      await Promise.all(trials.map((trial) => trial.done));
    },
  };
}
