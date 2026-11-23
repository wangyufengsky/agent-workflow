import { posix } from 'node:path';
import {
  AppError,
  type FunctionalTestServicePlan,
  type FunctionalTestServiceRuntime,
  PREVIEW_LOG_TAIL_CHARS,
  type ProjectJavaModule,
  type ProjectModuleCheck,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { locateShell } from '../git/index.ts';
import {
  createProjectLog,
  type PreviewCommand,
  projectLaunchEnvironment,
  setUpPreview,
  startServiceGroup,
} from '../previews/index.ts';
import { discoverTaskModules } from './discovery.ts';
import { runtimeCheckCommands } from './runtime-checks.ts';

type Input = {
  worktreePath: string;
  repoPath: string;
  changedPaths: readonly string[];
  env: NodeJS.ProcessEnv;
  clock: Clock;
  signal: AbortSignal;
};

export type IdeaAcceptanceResult =
  | { kind: 'fallback'; reason: string }
  | { kind: 'interrupted' }
  | { kind: 'checked'; passed: boolean; output: string; configurations: string[] };

type Candidate =
  | { kind: 'checks'; matches: { module: ProjectJavaModule; checks: ProjectModuleCheck[] }[] }
  | { kind: 'service'; name: string; plan: FunctionalTestServicePlan };

const fallback = (reason: string): IdeaAcceptanceResult => ({ kind: 'fallback', reason });
const javaChange =
  /(?:\.java$|(?:^|\/)src\/(?:main|test)\/resources\/.*\.(?:properties|xml|ya?ml|json)$|(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties)$)/;
// 只有文档和 IDE 元数据能随 Java 改动一起略过。未知源码、脚本和构建配置交给项目检查。
const ancillaryChange = /(?:\.(?:md|rst|adoc)$|(?:^|\/)(?:\.idea|\.run)\/.*\.xml$)/i;

function externalFailure(error: unknown): boolean {
  return (
    error instanceof AppError ||
    (error instanceof Error &&
      'code' in error &&
      ['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code)))
  );
}

function candidates(catalog: Awaited<ReturnType<typeof discoverTaskModules>>, changed: string[]): Candidate[] {
  const matched = new Map<ProjectJavaModule, string[]>();
  for (const path of changed) {
    const within = catalog.modules
      .filter((module) => module.directory === '.' || path.startsWith(`${module.directory}/`))
      .sort((a, b) => b.directory.length - a.directory.length);
    let module = within[0];
    if (module === undefined) return [];
    if (within[1]?.directory === module.directory) {
      const exact = within.filter(
        (candidate) => candidate.directory === module?.directory && candidate.evidence.includes(path),
      );
      if (exact.length !== 1) return [];
      module = exact[0];
      if (module === undefined) return [];
    }
    matched.set(module, [...(matched.get(module) ?? []), path]);
  }
  if (matched.size === 0) return [];
  const matches: Extract<Candidate, { kind: 'checks' }>['matches'] = [];
  for (const [module, paths] of matched) {
    const available = module.checks.filter(({ id }) => id.startsWith('idea:'));
    if (
      available.length > 0 &&
      module.build === 'gradle' &&
      catalog.modules.some(
        (other) => other !== module && (module.directory === '.' || other.directory.startsWith(`${module.directory}/`)),
      )
    )
      return [];
    const testRoot = `${posix.join(module.directory, 'src/test/java')}/`;
    const changedClasses = new Set(
      paths
        .filter((path) => path.startsWith(testRoot) && path.endsWith('.java'))
        .map((path) => path.slice(testRoot.length, -'.java'.length).replaceAll('/', '.')),
    );
    const exact = available.filter(({ testClass }) => testClass !== undefined && changedClasses.has(testClass));
    const suites = available.filter(({ testClass }) => testClass === undefined);
    let choices = suites.length > 0 ? suites : available;
    if (changedClasses.size > 0) {
      const covered = new Set(exact.map(({ testClass }) => testClass));
      choices = covered.size === changedClasses.size ? exact : suites;
      if (choices.length === 0) return [];
    }
    if (choices.length > 1 && (choices !== exact || choices.length !== changedClasses.size)) return [];
    if (choices.length === 0) break;
    matches.push({ module, checks: choices });
  }
  if (matches.length === matched.size) return [{ kind: 'checks', matches }];
  // A ready-only launch cannot replace a real test in another changed module.
  if (
    matches.length > 0 ||
    [...matched.keys()].some((module) => module.checks.some(({ id }) => id.startsWith('idea:')))
  )
    return [];

  const moduleIds = new Set([...matched.keys()].map(({ id }) => id));
  const compound: Candidate[] = [];
  for (const config of catalog.compounds) {
    if (config.plan == null) continue;
    const plan = config.plan;
    const affected = plan.services.filter(({ moduleId }) => moduleId !== undefined && moduleIds.has(moduleId));
    const covered = new Set(affected.map(({ moduleId }) => moduleId));
    if (covered.size !== moduleIds.size) continue;
    const required = new Set(affected.map(({ id }) => id));
    const bindings = new Map(plan.services.map((service) => [service.id, service]));
    for (const id of required) {
      for (const dependency of bindings.get(id)?.dependsOn ?? []) required.add(dependency);
    }
    if (required.size === plan.services.length) compound.push({ kind: 'service', name: config.name, plan });
  }
  if (compound.length > 0 || matched.size !== 1) return compound;
  const module = [...matched.keys()][0];
  if (module === undefined) return [];
  return module.configurations.flatMap((configuration) => {
    if (!configuration.id.startsWith('idea:') || configuration.launch == null || configuration.review.length > 0)
      return [];
    return [
      {
        kind: 'service',
        name: configuration.name,
        plan: {
          targetServiceId: configuration.id,
          services: [
            {
              id: configuration.id,
              name: configuration.name,
              moduleId: module.id,
              launch: configuration.launch,
              dependsOn: [],
              inject: [],
            },
          ],
        },
      },
    ];
  });
}

export async function runIdeaAcceptance(input: Input): Promise<IdeaAcceptanceResult> {
  const { signal, clock, worktreePath, repoPath } = input;
  if (signal.aborted) return { kind: 'interrupted' };
  if (input.changedPaths.some((path) => !javaChange.test(path) && !ancillaryChange.test(path)))
    return fallback('本次改动包含 IDEA Java 配置无法验证的文件，改用项目检查命令。');
  const changed = input.changedPaths.filter((path) => javaChange.test(path));
  if (changed.length === 0) return fallback('本次改动未涉及可匹配的 Java 模块。');
  let catalog: Awaited<ReturnType<typeof discoverTaskModules>>;
  try {
    catalog = await discoverTaskModules(worktreePath, repoPath);
  } catch (error) {
    if (signal.aborted) return { kind: 'interrupted' };
    if (!externalFailure(error)) throw error;
    return fallback('无法读取任务工作区或本机 IDEA 配置。');
  }
  if (signal.aborted) return { kind: 'interrupted' };
  const selected = candidates(catalog, changed);
  const candidate = selected[0];
  if (selected.length !== 1 || candidate === undefined) return fallback('没有找到能明确覆盖本次改动的 IDEA 验收配置。');

  const worktree = { path: worktreePath, baseCommit: catalog.baseline };
  const env = { ...projectLaunchEnvironment(input.env), CI: 'true' };
  if (candidate.kind === 'checks') {
    let commands: PreviewCommand[];
    let shell: string;
    try {
      shell = await locateShell(env);
      commands = (
        await Promise.all(
          candidate.matches.map(({ module, checks }) => runtimeCheckCommands(worktree, module, checks, env, true)),
        )
      ).flat();
    } catch (error) {
      if (signal.aborted) return { kind: 'interrupted' };
      if (!externalFailure(error)) throw error;
      return fallback('已匹配 IDEA 测试，但当前工作区或构建工具无法运行该配置。');
    }
    const configurations = candidate.matches.flatMap(({ checks }) => checks.map(({ name }) => name));
    const log = createProjectLog(input.env);
    try {
      for (const command of commands) {
        await setUpPreview(command, {
          config: { readyPath: '/', command: () => command },
          directory: worktreePath,
          env,
          clock,
          shell,
          log,
          signal,
        });
      }
      log.flush();
      return { kind: 'checked', passed: true, configurations, output: log.tail() };
    } catch (error) {
      if (signal.aborted) return { kind: 'interrupted' };
      if (!(error instanceof AppError)) throw error;
      log.append(`IDEA 测试执行失败：${error.message}\n`);
      log.flush();
      return { kind: 'checked', passed: false, configurations, output: log.tail() };
    } finally {
      log.close();
    }
  }

  let observations: FunctionalTestServiceRuntime[] = [];
  const configurations = [candidate.name];
  try {
    const group = await startServiceGroup({
      worktree,
      env,
      clock,
      signal,
      plan: candidate.plan,
      allowWorkingTreeChanges: true,
      update: (current) => {
        observations = current;
      },
    });
    await group.stop();
    if (signal.aborted) return { kind: 'interrupted' };
    if (group.failure() !== undefined)
      return {
        kind: 'checked',
        passed: false,
        configurations,
        output: observations
          .map(({ name, id, logTail }) => `${name ?? id}\n${logTail}`)
          .join('\n')
          .slice(-PREVIEW_LOG_TAIL_CHARS),
      };
    return {
      kind: 'checked',
      passed: true,
      configurations,
      output: observations
        .map(({ name, id, readyStatus, logTail }) => `${name ?? id} 就绪（HTTP ${readyStatus}）\n${logTail}`)
        .join('\n')
        .slice(-PREVIEW_LOG_TAIL_CHARS),
    };
  } catch (error) {
    if (signal.aborted) return { kind: 'interrupted' };
    if (!externalFailure(error)) throw error;
    if (!observations.some(({ target, diagnostics }) => target !== null || (diagnostics?.beforeRun.length ?? 0) > 0))
      return fallback('已匹配 IDEA 应用，但当前工作区或运行工具无法启动该配置。');
    const log = createProjectLog(input.env);
    log.append(`IDEA 应用未能就绪：${error instanceof Error ? error.message : String(error)}\n`);
    for (const service of observations) log.append(service.logTail);
    log.flush();
    return { kind: 'checked', passed: false, configurations, output: log.tail() };
  }
}
