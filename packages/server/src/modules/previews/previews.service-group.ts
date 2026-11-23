import {
  AppError,
  ErrorCode,
  type FunctionalTestServicePlan,
  type FunctionalTestServiceRuntime,
  functionalTestServiceInjectionEnvironmentSchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { locateShell } from '../git/index.ts';
import { launchDiagnostics } from './previews.launch-diagnostics.ts';
import { type LaunchInput, launchPreview, type RunningPreview, setUpPreview } from './previews.process.ts';
import { createProjectLog } from './previews.project-log.ts';
import { type ResolvedTestLaunch, resolveTestLaunch } from './previews.test-launch.ts';

type Service = FunctionalTestServicePlan['services'][number];
type Item = {
  service: Service;
  observation: FunctionalTestServiceRuntime;
  log: ReturnType<typeof createProjectLog>;
  process?: RunningPreview;
};

type StartServiceGroup = {
  worktree: { path: string; baseCommit: string };
  plan: FunctionalTestServicePlan;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  signal: AbortSignal;
  update?(services: FunctionalTestServiceRuntime[]): void;
};

function ordered(plan: FunctionalTestServicePlan): Service[] {
  const services = new Map(plan.services.map((service) => [service.id, service]));
  const invalid = (message: string) => new AppError(ErrorCode.ValidationFailed, message);
  if (services.size !== plan.services.length || !services.has(plan.targetServiceId))
    throw invalid('A service plan needs unique services and a selected target');
  for (const service of services.values()) {
    const dependencies = new Set(service.dependsOn);
    if (dependencies.size !== service.dependsOn.length || [...dependencies].some((id) => !services.has(id)))
      throw invalid('Service dependencies must name distinct members of the same plan');
    const keys = new Set<string>();
    for (const { env, serviceId } of service.inject) {
      if (
        !dependencies.has(serviceId) ||
        keys.has(env) ||
        !functionalTestServiceInjectionEnvironmentSchema.safeParse(env).success
      )
        throw invalid('Inject only distinct URL, URI or ORIGIN variables from declared dependencies');
      keys.add(env);
    }
  }
  const result: Service[] = [];
  const waiting = new Set(services.values());
  const ready = new Set<string>();
  while (waiting.size !== 0) {
    const size = waiting.size;
    for (const service of waiting) {
      if (!service.dependsOn.every((id) => ready.has(id))) continue;
      waiting.delete(service);
      ready.add(service.id);
      result.push(service);
    }
    if (size === waiting.size) throw invalid('Service plan dependencies contain a cycle');
  }
  return result;
}

export async function startServiceGroup(input: StartServiceGroup) {
  const { env, plan, worktree, clock } = input;
  const items = ordered(plan).map(
    (service): Item => ({
      service,
      observation: {
        id: service.id,
        name: service.name ?? service.id,
        ...(service.moduleId === undefined ? {} : { moduleId: service.moduleId }),
        target: null,
        readyUrl: null,
        readyStatus: null,
        logTail: '',
      },
      log: createProjectLog(env),
    }),
  );
  const byId = new Map(items.map((item) => [item.service.id, item]));
  const bindingNames = new Set(plan.services.flatMap(({ inject }) => inject.map(({ env: key }) => key)));
  const groupEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !bindingNames.has(key.toUpperCase())));
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const snapshot = () => items.map(({ observation, log }) => ({ ...observation, logTail: log.tail() }));
  const update = () => input.update?.(snapshot());
  let starting = true;
  let failure: AppError | undefined;
  let ending: Promise<void> | undefined;
  const stop = () => {
    controller.abort();
    ending ??= (async () => {
      try {
        const results = await Promise.allSettled(items.toReversed().map((item) => item.process?.stop()));
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      } finally {
        for (const item of items) {
          item.log.flush();
          item.log.close();
        }
        update();
      }
    })();
    return ending;
  };
  const done = Promise.withResolvers<void>();
  const abort = () => {
    if (!starting) void stop().then(done.resolve, done.reject);
  };
  signal.addEventListener('abort', abort, { once: true });
  function failed(serviceId: string, error: unknown) {
    if (signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    failure = new AppError(
      error instanceof AppError ? error.code : ErrorCode.PreviewStartFailed,
      `Service ${serviceId}: ${message}`,
    );
    controller.abort(failure);
  }

  let builds = Promise.resolve();
  const reservedPorts = new Set<number>();
  async function launchItem(item: Item, config: ResolvedTestLaunch, shell: string) {
    signal.throwIfAborted();
    const injected = Object.fromEntries(
      item.service.inject.map(({ env: key, serviceId }) => {
        const origin = byId.get(serviceId)?.observation.target;
        if (origin == null)
          throw new AppError(ErrorCode.PreviewStartFailed, `Dependency ${serviceId} has no ready address`);
        return [key, origin];
      }),
    );
    const beforeRun: string[] = [];
    const record = (args: string[]) => {
      item.observation.diagnostics = launchDiagnostics(config, item.service.launch, args, {
        beforeRun,
        injectedEnvironment: Object.keys(injected),
      });
    };
    const launch: LaunchInput = {
      config: {
        readyPath: config.evidence.readyPath,
        command(port) {
          const command = config.command(port);
          record(command.args);
          return command;
        },
      },
      directory: config.directory,
      env: config.env,
      shell,
      log: item.log,
      clock,
      signal,
      reservedPorts,
      onLaunch: ({ readyUrl }) => {
        item.observation.target = new URL(readyUrl).origin;
        item.observation.readyUrl = readyUrl;
        update();
      },
      onProbe: (status) => {
        item.observation.readyStatus = status;
        update();
      },
    };
    record([]);
    if (config.setup !== undefined || config.prepare !== undefined) {
      // Compilers and dependency installers in different modules can still share the same project's build directory.
      const prepared = builds.then(async () => {
        signal.throwIfAborted();
        if (config.setup !== undefined) {
          beforeRun.push('install_dependencies');
          record([]);
          await setUpPreview(config.setup, launch);
        }
        if (config.prepare !== undefined) {
          beforeRun.push(config.evidence.manager === 'gradle' ? 'gradle_classes' : 'maven_compile');
          record([]);
          await config.prepare((command) => setUpPreview(command, launch));
        }
      });
      builds = prepared.catch((error: unknown) => failed(item.service.id, error));
      await prepared;
    }
    item.process = await launchPreview({ ...launch, env: { ...config.env, ...injected } });
    void item.process.exited.then(() => failed(item.service.id, new Error('process exited')));
  }

  try {
    signal.throwIfAborted();
    update();
    const shell = await locateShell(groupEnv);
    const configs = await Promise.allSettled(
      items.map(async ({ service }) => {
        try {
          return [service.id, await resolveTestLaunch(worktree, service.launch, groupEnv)] as const;
        } catch (error) {
          failed(service.id, error);
          throw error;
        }
      }),
    );
    if (failure !== undefined) throw failure;
    signal.throwIfAborted();
    const byService = new Map(configs.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
    const startup = new Map<string, Promise<void>>();
    for (const item of items) {
      const ready = Promise.all(item.service.dependsOn.map((dependency) => startup.get(dependency)))
        .then(async () => {
          const config = byService.get(item.service.id);
          if (config === undefined) throw new Error('Service configuration disappeared');
          await launchItem(item, config, shell);
        })
        .catch((error: unknown) => {
          failed(item.service.id, error);
          throw error;
        });
      startup.set(item.service.id, ready);
    }
    const outcomes = await Promise.allSettled(startup.values());
    const error = outcomes.find((outcome) => outcome.status === 'rejected');
    if (error?.status === 'rejected') throw error.reason;
    signal.throwIfAborted();
    starting = false;
    const target = byId.get(plan.targetServiceId)?.observation.target;
    if (target == null) throw new Error('Selected service has no loopback address');
    return {
      target,
      targetServiceId: plan.targetServiceId,
      signal,
      snapshot,
      stop,
      exited: done.promise,
      failure: () => failure,
    };
  } catch (error) {
    await stop();
    throw failure ?? error;
  }
}
