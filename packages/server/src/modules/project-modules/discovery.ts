import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  functionalTestLaunchSchema,
  functionalTestMainClassSchema,
  type IdeConfiguration,
  type ProjectJavaModule,
  type ProjectModuleCheck,
  type ProjectModuleConfiguration,
} from '@aw/shared';
import { hasJavaMain } from '../previews/index.ts';
import { type BuildHints, gradleHints, gradleSettings, mavenHints } from './discovery-build.ts';
import { baselineTree } from './discovery-git.ts';
import { discoverIdeaConfigurations, type IdeaTest } from './discovery-idea.ts';

const JAVA_LIMIT = 384;
const MANIFEST_LIMIT = 128;
const DOCUMENT_LIMIT = 16;
const CONFIG_LIMIT = 128;
const DEFAULT_HINTS: BuildHints = {
  modules: [],
  dependencies: [],
  spring: false,
  batch: false,
  junit: false,
  aggregate: false,
};
const JAVA_PACKAGE = /^\s*package\s+([\p{L}\p{N}\p{M}.$_]+)\s*;/mu;
const DOC_NAME =
  /^(?:readme|agents?|contributing|running|run|testing|test|launch|setup)(?:[._-][^/]*)?\.(?:md|txt|adoc)$/i;
const READY_PATH =
  /^\s*(?:[-*]\s+)?(?:(?:ready|readiness|health(?: check)?)\s+(?:path|endpoint)|(?:就绪|健康检查)(?:路径|端点))\s*[:：]\s*`?(\/(?!\/)[^\s`#?]*)/gim;

const SERVICE_DOC =
  /^\s*(?:[-*]\s+)?(?:\*\*)?(?:(?:module|application|runtime|service)\s+(?:kind|type)|模块类型|应用类型|运行类型)(?:\*\*)?\s*[:：]\s*(?:\*\*|`)?(?:(?:(?:http|https|web)\s+)?service\b|(?:HTTP|HTTPS|Web)?\s*服务(?:模块)?(?:\s|$|[，。*]))/im;
const HTTP_SERVICE_DOC = /^\s*(?:[-*]\s+|#{1,6}\s+)?(?:\*\*)?(?:HTTP|HTTPS|Web)\s*(?:service\b|服务)/im;

type Main = { path: string; name: string; service: boolean; batch: boolean };
type Module = {
  id: string;
  directory: string;
  source: string;
  build: ProjectJavaModule['build'];
  hints: BuildHints;
  memberships: Set<string>;
  gradleProjects: Map<string, string>;
  dependentModules: Set<string>;
  mains: Main[];
  tests: { name: string; path: string }[];
  production: string[];
};

function digest(input: readonly unknown[]) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function within(path: string, directory: string) {
  return directory === '.' || path.startsWith(`${directory}/`);
}

function moduleFor(path: string, modules: readonly Module[]) {
  return modules.find((module) => within(path, module.directory));
}

function javaText(content: string) {
  return content.replace(
    /"""(?:\\[\s\S]|(?!""")[\s\S])*"""|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (token) => token.replace(/[^\r\n]/g, ' '),
  );
}

function qualifiedName(path: string, text: string) {
  const pkg = JAVA_PACKAGE.exec(text)?.[1];
  const name = posix.basename(path, '.java');
  return pkg === undefined ? name : `${pkg}.${name}`;
}

function serviceSource(text: string) {
  return /(?:\b(?:com\.sun\.net\.httpserver\.HttpServer|io\.javalin\.Javalin|spark\.Spark|io\.undertow\.Undertow|io\.micronaut\.runtime\.Micronaut|io\.quarkus\.runtime\.Quarkus)\b|@(?:RestController|WebServlet|ServerEndpoint)\b)/.test(
    text,
  );
}

function batchSource(text: string) {
  return /\borg\.springframework\.batch\.|\bimplements\s+(?:CommandLineRunner|ApplicationRunner)\b/.test(text);
}

function newModule(source: string, build: Module['build']): Module {
  const directory = posix.dirname(source);
  return {
    id: build === 'standalone' ? `java:${source}` : `${build}:${directory}`,
    source,
    build,
    directory,
    hints: DEFAULT_HINTS,
    memberships: new Set(),
    gradleProjects: new Map(),
    dependentModules: new Set(),
    mains: [],
    tests: [],
    production: [],
  };
}

async function discoverBuilds(tree: Awaited<ReturnType<typeof baselineTree>>, warnings: string[]) {
  const paths = [...tree.files.keys()];
  const manifests = paths.filter((path) => /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/.test(path));
  if (manifests.length > MANIFEST_LIMIT) warnings.push('Build manifest discovery limit reached');
  const modules: Module[] = [];
  for (const path of manifests.slice(0, MANIFEST_LIMIT)) {
    const build = path.endsWith('pom.xml') ? 'maven' : 'gradle';
    const module = newModule(path, build);
    const content = await tree.text(path);
    try {
      if (content === undefined) throw new Error('Manifest unavailable');
      module.hints = build === 'maven' ? mavenHints(content) : gradleHints(content);
    } catch {
      warnings.push(`${path}: could not inspect the baseline build manifest`);
    }
    if (!modules.some((existing) => existing.id === module.id)) modules.push(module);
  }
  const lookup = new Map(modules.map((module) => [module.id, module]));
  for (const parent of modules) {
    for (const path of parent.hints.modules) {
      const child = lookup.get(`maven:${posix.join(parent.directory, path)}`);
      if (child) child.memberships.add(parent.source);
      else warnings.push(`${parent.source}: listed Maven module ${path} has no baseline pom.xml`);
    }
  }
  for (const path of paths
    .filter((entry) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(entry))
    .slice(0, MANIFEST_LIMIT)) {
    const content = await tree.text(path);
    if (content === undefined) continue;
    const projects = gradleSettings(content, posix.dirname(path));
    lookup.get(`gradle:${posix.dirname(path)}`)?.gradleProjects.set(path, ':');
    for (const [name, directory] of projects) {
      const child = lookup.get(`gradle:${directory}`);
      if (child) {
        child.memberships.add(path);
        child.gradleProjects.set(path, name);
      } else warnings.push(`${path}: listed Gradle project ${name} has no baseline build file`);
    }
  }
  resolveDependencies(modules);
  return modules.sort(
    (a, b) =>
      b.directory.split('/').length - a.directory.split('/').length ||
      Number(a.directory === '.') - Number(b.directory === '.'),
  );
}

function mavenCoordinate(module: Module) {
  const { group, name } = module.hints;
  if (module.build !== 'maven' || !group || !name || !/^[\w.-]+$/.test(group) || !/^[\w.-]+$/.test(name))
    return undefined;
  return `${group}:${name}`;
}

function resolveDependencies(modules: Module[]) {
  for (const dependent of modules) {
    for (const dependency of new Set(dependent.hints.dependencies)) {
      const candidates = modules.filter((module) =>
        dependent.build === 'maven'
          ? mavenCoordinate(module) === dependency
          : [...dependent.gradleProjects.keys()].some((root) => module.gradleProjects.get(root) === dependency),
      );
      if (candidates.length === 1 && candidates[0] !== dependent) candidates[0]?.dependentModules.add(dependent.id);
    }
  }
}

async function discoverSources(tree: Awaited<ReturnType<typeof baselineTree>>, modules: Module[], warnings: string[]) {
  const candidates = (await tree.javaCandidates()).filter((path) => tree.files.has(path));
  if (candidates.length > JAVA_LIMIT) warnings.push('Java entrypoint and JUnit source discovery limit reached');
  const builds = [...modules];
  for (const path of tree.files.keys()) {
    if (!path.endsWith('.java')) continue;
    const owner = moduleFor(path, builds);
    if (owner && path.startsWith(posix.join(owner.directory, 'src/main/java/'))) owner.production.push(path);
  }
  const inspected = candidates.slice(0, JAVA_LIMIT);
  for (let index = 0; index < inspected.length; index += 12) {
    const batch = inspected.slice(index, index + 12);
    const contents = await Promise.all(batch.map(async (path) => ({ path, content: await tree.text(path) })));
    for (const { path, content } of contents) {
      if (content === undefined) continue;
      const owner = moduleFor(path, builds);
      const text = javaText(content);
      const name = qualifiedName(path, text);
      if (!functionalTestMainClassSchema.safeParse(name).success) continue;
      if (owner && path === posix.join(owner.directory, 'src/test/java', `${name.replaceAll('.', '/')}.java`)) {
        if (
          (/\borg\.junit(?:\.|;)/.test(text) &&
            /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/.test(text)) ||
          (/\bjunit\.framework\.TestCase\b/.test(text) && /\bextends\s+(?:junit\.framework\.)?TestCase\b/.test(text))
        )
          owner.tests.push({ name, path });
        continue;
      }
      if (owner && path !== posix.join(owner.directory, 'src/main/java', `${name.replaceAll('.', '/')}.java`)) continue;
      if (!owner && /(?:^|\/)(?:test|tests|target|build|\.gradle)\//.test(path)) continue;
      if (!hasJavaMain(content, name, !owner)) continue;
      const module = owner ?? newModule(path, 'standalone');
      module.mains.push({ path, name, service: serviceSource(text), batch: batchSource(text) });
      if (!owner) modules.push(module);
    }
  }
}

function moduleKind(module: Module, documentedServices: ReadonlySet<string>): ProjectJavaModule['kind'] {
  if (
    documentedServices.size > 0 ||
    module.mains.some((main) => main.service) ||
    (module.mains.length > 0 && module.hints.spring)
  )
    return 'service';
  if (module.mains.some((main) => main.batch) || (module.mains.length > 0 && module.hints.batch)) return 'batch';
  if (!module.mains.length && module.production.length && !module.hints.aggregate) return 'library';
  return 'unknown';
}

function bindModule(
  modules: readonly Module[],
  configuration: { directory?: string | undefined; module?: string | undefined },
) {
  const byDirectory =
    configuration.directory === undefined
      ? modules
      : modules.filter((module) => module.directory === configuration.directory);
  const moduleName = configuration.module?.replace(/\.(?:main|test)$/, '');
  if (!moduleName) return byDirectory.length === 1 ? byDirectory[0] : undefined;
  const names = (module: Module) => [module.hints.name, posix.basename(module.directory)];
  const matches = modules.filter((module) => names(module).includes(moduleName));
  const named =
    matches.length > 0
      ? matches
      : modules.filter((module) => names(module).some((name) => name && moduleName.endsWith(`.${name}`)));
  if (named.length === 0) return byDirectory.length === 1 ? byDirectory[0] : undefined;
  const intersection = named.filter((module) => byDirectory.includes(module));
  return intersection.length === 1 ? intersection[0] : undefined;
}

function bindIdea(modules: readonly Module[], configuration: IdeConfiguration) {
  const matches = modules.filter((module) => module.mains.some((main) => main.name === configuration.mainClass));
  // If the class has a single owner but the IDEA working directory is different, retain it with manual review.
  return matches.length === 1 ? matches[0] : bindModule(matches, configuration);
}

function bindTest(modules: readonly Module[], configuration: IdeaTest) {
  const matches = modules.filter(
    (module) =>
      module.build !== 'standalone' &&
      !module.hints.aggregate &&
      (configuration.kind === 'junit'
        ? module.tests.some((test) => test.name === configuration.testClass)
        : module.build === configuration.kind),
  );
  if (configuration.kind !== 'junit' && configuration.directory === undefined && configuration.module === undefined)
    return matches.find((module) => module.directory === '.');
  return bindModule(matches, configuration);
}

function moduleChecks(module: Module, configurations: IdeaTest[]): ProjectModuleCheck[] {
  const { build, hints, tests, source } = module;
  if (build === 'standalone' || hints.aggregate) return [];
  const ideaChecks = configurations
    .filter((config) => config.testClass === undefined || config.testClass.includes('.'))
    .map(
      (config): ProjectModuleCheck => ({
        id: `idea:${config.scope}:${config.source}:${config.name}`,
        name: config.name,
        source: config.source,
        kind: `${build}-${config.kind === 'junit' ? 'junit' : 'test'}`,
        ...(config.testClass === undefined ? {} : { testClass: config.testClass }),
      }),
    );
  const uniqueIdea = [...new Map(ideaChecks.map((check) => [check.id, check])).values()];
  const defaultSuite = (hints.junit || tests.length > 0) && !uniqueIdea.some((check) => check.testClass === undefined);
  const discoveredClasses = tests.filter(
    (test) => test.name.includes('.') && !uniqueIdea.some((check) => check.testClass === test.name),
  );
  return [
    ...uniqueIdea,
    ...(defaultSuite ? [{ id: `${build}:test`, name: 'All tests', source, kind: `${build}-test` as const }] : []),
    ...discoveredClasses.map(
      ({ name, path }): ProjectModuleCheck => ({
        id: `${build}:junit:${name}`,
        name,
        source: path,
        kind: `${build}-junit`,
        testClass: name,
      }),
    ),
  ];
}

async function moduleDocs(tree: Awaited<ReturnType<typeof baselineTree>>, module: Module) {
  const adjacent = [...tree.files.keys()].filter(
    (path) =>
      within(path, module.directory) &&
      ((posix.dirname(path) === module.directory && DOC_NAME.test(posix.basename(path))) ||
        (posix.dirname(path) === posix.join(module.directory, 'docs') && /\.(?:md|txt|adoc)$/i.test(path))),
  );
  const documents = new Set(adjacent.slice(0, DOCUMENT_LIMIT));
  const readyPaths = new Set<string>();
  const documentedServices = new Set<string>();
  for (const document of documents) {
    const text = await tree.text(document);
    if (text === undefined) continue;
    for (const link of text.matchAll(/\[[^\]]*\]\(<?([^\s>#?]+\.(?:md|txt|adoc))>?(?:#[^\s)]+)?\)/gi)) {
      if (documents.size >= DOCUMENT_LIMIT) break;
      const path = link[1];
      if (path === undefined || /^(?:\/|[\w+-]+:)/.test(path)) continue;
      const target = posix.join(posix.dirname(document), path);
      if (within(target, module.directory) && tree.files.has(target)) documents.add(target);
    }
    if (SERVICE_DOC.test(text) || HTTP_SERVICE_DOC.test(text)) {
      for (const main of module.mains) {
        if (module.mains.length === 1 || text.includes(`\`${main.name}\``)) documentedServices.add(main.name);
      }
    }
    for (const match of text.matchAll(READY_PATH)) {
      if (match[1]) readyPaths.add(match[1]);
    }
  }
  return {
    documents: [...documents],
    readyPaths,
    documentedServices: readyPaths.size === 1 ? documentedServices : new Set<string>(),
  };
}

function moduleConfigurations(
  tree: Awaited<ReturnType<typeof baselineTree>>,
  module: Module,
  configs: IdeConfiguration[],
  docs: Awaited<ReturnType<typeof moduleDocs>>,
): ProjectModuleConfiguration[] {
  const configurations: ProjectModuleConfiguration[] = [];
  for (const main of module.mains) {
    const entries = configs.filter((config) => config.mainClass === main.name);
    for (const entry of entries.length > 0 ? entries : [undefined]) {
      const scope = entry?.location === 'project' ? 'local' : 'project';
      const source = entry?.source ?? main.path;
      const id = entry ? `idea:${scope}:${source}:${entry.name}` : `main:${main.name}`;
      const review = [...(entry?.review ?? [])];
      if (entry?.directory !== undefined && entry.directory !== module.directory) review.push('working directory');
      if (entry?.profile !== undefined) review.push('Spring profile');
      if (entry?.includeProvided && module.build !== 'maven') review.push('provided dependencies');
      if (entry?.javaVersion !== undefined && entry.javaVersion < 11 && module.build === 'standalone')
        review.push('standalone Java requires JDK 11 or newer');
      if (docs.readyPaths.size > 1) review.push('conflicting documented readiness paths');
      const launch = functionalTestLaunchSchema.safeParse({
        source: module.source,
        directory: module.directory,
        script: 'java-main',
        mainClass: main.name,
        readyPath: [...docs.readyPaths][0] ?? '/',
        ...(entry?.javaVersion === undefined ? {} : { javaVersion: entry.javaVersion }),
        ...(entry?.includeProvided === undefined ? {} : { includeProvided: entry.includeProvided }),
      });
      if (!launch.success) review.push('unsupported preview configuration');
      const configuration = {
        id,
        name: entry?.name ?? main.name,
        source,
        scope,
        mainClass: main.name,
        directory: module.directory,
        ...(entry?.javaVersion === undefined ? {} : { javaVersion: entry.javaVersion }),
        ...(entry?.includeProvided === undefined ? {} : { includeProvided: entry.includeProvided }),
        review: [...new Set(review)],
        launch:
          review.length === 0 &&
          (main.service || module.hints.spring || docs.documentedServices.has(main.name)) &&
          launch.success
            ? launch.data
            : null,
      } satisfies Omit<ProjectModuleConfiguration, 'fingerprint'>;
      if (configurations.some((existing) => existing.id === id)) continue;
      const evidence = [module.source, main.path, source, ...module.memberships, ...docs.documents];
      configurations.push({
        ...configuration,
        fingerprint: digest([configuration, evidence.map((path) => tree.files.get(path)?.oid ?? null)]),
      });
    }
  }
  return configurations;
}

export async function discoverProjectModules(repoPath: string, branch: string) {
  const warnings: string[] = [];
  const tree = await baselineTree(repoPath, branch);
  const [modules, idea] = await Promise.all([
    discoverBuilds(tree, warnings),
    discoverIdeaConfigurations(repoPath, tree, warnings),
  ]);
  await discoverSources(tree, modules, warnings);
  if (idea.configurations.length > CONFIG_LIMIT || idea.tests.length > CONFIG_LIMIT)
    warnings.push('IDEA Java configuration discovery limit reached');
  const byModule = new Map<Module, IdeConfiguration[]>();
  for (const config of idea.configurations.slice(0, CONFIG_LIMIT)) {
    const module = bindIdea(modules, config);
    if (!module) {
      warnings.push(
        `${config.source}: IDEA configuration "${config.name}" has no unique matching main class at the baseline`,
      );
      continue;
    }
    const attached = byModule.get(module) ?? [];
    attached.push(config);
    byModule.set(module, attached);
  }
  const testsByModule = new Map<Module, IdeaTest[]>();
  for (const test of idea.tests.slice(0, CONFIG_LIMIT)) {
    const module = bindTest(modules, test);
    if (!module) {
      warnings.push(
        `${test.source}: IDEA test configuration "${test.name}" has no unique matching build or test class at the baseline`,
      );
      continue;
    }
    testsByModule.set(module, [...(testsByModule.get(module) ?? []), test]);
  }
  const result: ProjectJavaModule[] = [];
  for (const module of modules.sort((a, b) => a.id.localeCompare(b.id))) {
    const docs = await moduleDocs(tree, module);
    result.push({
      id: module.id,
      name:
        module.hints.name ??
        (module.build === 'standalone' ? module.mains[0]?.name : undefined) ??
        posix.basename(module.directory === '.' ? repoPath : module.directory),
      directory: module.directory,
      build: module.build,
      kind: moduleKind(module, docs.documentedServices),
      configurations: moduleConfigurations(tree, module, byModule.get(module) ?? [], docs),
      checks: moduleChecks(module, testsByModule.get(module) ?? []),
      ...(module.dependentModules.size === 0 ? {} : { dependentModules: [...module.dependentModules].sort() }),
      evidence: [
        ...new Set([
          module.source,
          ...module.memberships,
          ...module.mains.map(({ path }) => path),
          ...module.tests.map(({ path }) => path),
          ...module.production.slice(0, 4),
          ...docs.documents,
        ]),
      ],
    });
  }
  return { baseline: tree.baseline, modules: result, warnings: [...new Set(warnings)].sort() };
}
