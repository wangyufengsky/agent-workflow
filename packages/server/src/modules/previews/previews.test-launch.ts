import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { AppError, ErrorCode, FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT, type FunctionalTestLaunch } from '@aw/shared';
import { SaxesParser } from 'saxes';
import { z } from 'zod';
import { runGit } from '../git/index.ts';
import type { Worktree } from '../worktrees/index.ts';
import {
  type CommittedSource,
  findManager,
  javaBuildExecutable,
  type PreparePreviewCommand,
  type PreviewCommand,
  projectLaunchEnvironment,
} from './previews.commands.ts';
import { javaCommands } from './previews.java-launch.ts';
import { verifySpringProfile } from './previews.spring-profile.ts';

const LOOPBACK = '127.0.0.1';
const SERVICE_SCRIPT =
  /^(?:dev|start|serve|preview)(?:[:.-](?:test|qa|local|dev|api|server))?$|^(?:test|qa|local):(?:dev|start|serve)$/;
const NODE_PROFILE = /^(?:cross-env )?NODE_ENV=(test|qa) (node .+)$/;
const VITE_MODE = /^vite(?: dev| serve)?(?: --mode (test|qa))?$/;
const SERVER_ENTRY = /^(?:node(?: --watch)?|tsx)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))$/;
const FRAMEWORK_SERVICE =
  /^(?:vite(?: dev| serve)?|next dev|astro dev|nuxt dev|react-scripts start|nest start(?: --watch)?)$/;
type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'maven' | 'gradle' | 'java';
export type TestLaunchEvidence = FunctionalTestLaunch & { manager: Manager; baseline: string };
export type ResolvedTestLaunch = {
  directory: string;
  evidence: TestLaunchEvidence;
  command: (port: number) => PreviewCommand;
  setup?: PreviewCommand;
  prepare?: PreparePreviewCommand;
  env: NodeJS.ProcessEnv;
};

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  packageManager: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});
const LOCKS = [
  ['pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
  ['yarn.lock', 'yarn', ['install', '--frozen-lockfile', '--ignore-scripts']],
  ['bun.lock', 'bun', ['install', '--frozen-lockfile', '--ignore-scripts']],
  ['bun.lockb', 'bun', ['install', '--frozen-lockfile', '--ignore-scripts']],
  ['package-lock.json', 'npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts']],
] as const;
const MANIFEST_MAX_BYTES = 1024 * 1024;

function invalid(message: string, path?: string) {
  return new AppError(ErrorCode.ValidationFailed, message, path === undefined ? undefined : { path });
}

function relativePath(path: string, rootAllowed: boolean): string {
  if ((path === '.' || path === '') && rootAllowed) return '.';
  if (
    path.length > 1024 ||
    /[\\:\p{Cc}]/u.test(path) ||
    path
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git')
  )
    throw invalid('Use a path inside the test worktree', path);
  return path;
}

async function fileMetadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
      return undefined;
    throw error;
  }
}

export function committedSources(root: string, baseline: string) {
  return async (relative: string, required: boolean) => {
    let absolute = root;
    for (const component of relative.split('/')) {
      absolute = join(absolute, component);
      const entry = await fileMetadata(absolute);
      if (entry?.isSymbolicLink()) throw invalid('Test launch evidence must not follow a symbolic link', relative);
      if (entry === undefined) {
        if (required) throw invalid('Test launch source does not exist', relative);
        return undefined;
      }
    }
    const file = await lstat(absolute);
    if (!file.isFile()) throw invalid('Test launch source must be a regular file', relative);
    const pathspec = `:(literal)${relative}`;
    const { stdout } = await runGit(['ls-tree', baseline, '--', pathspec], { cwd: root });
    if (!/^100(?:644|755) blob /.test(stdout)) throw invalid('Test launch source must be a committed file', relative);
    const difference = await runGit(['diff', '--quiet', baseline, '--', pathspec], { cwd: root, okExitCodes: [0, 1] });
    if (difference.exitCode !== 0) throw invalid('Test launch source differs from the selected baseline', relative);
    return { absolute, size: file.size };
  };
}
async function nodeCommands(
  launch: FunctionalTestLaunch,
  manifest: string,
  root: string,
  committed: CommittedSource,
  env: NodeJS.ProcessEnv,
): Promise<{
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  command: (port: number) => PreviewCommand;
  profile: FunctionalTestLaunch['profile'];
  nodeEnvironment: string;
  setup?: PreviewCommand;
}> {
  let contents: unknown;
  try {
    contents = JSON.parse(manifest);
  } catch (err) {
    if (err instanceof SyntaxError) throw invalid('The committed package.json is not valid JSON', launch.source);
    throw err;
  }
  const parsed = packageSchema.safeParse(contents);
  const scripts = parsed.data?.scripts ?? {};
  const service = scripts[launch.script]?.trim() ?? '';
  if (
    !SERVICE_SCRIPT.test(launch.script) ||
    !Object.hasOwn(scripts, launch.script) ||
    Object.hasOwn(scripts, `pre${launch.script}`) ||
    Object.hasOwn(scripts, `post${launch.script}`)
  )
    throw invalid('Choose a committed service script without pre/post lifecycle scripts', launch.source);
  const environmentDeclaration = NODE_PROFILE.exec(service);
  const declaredEnv = environmentDeclaration?.[1];
  const serviceEntry = environmentDeclaration?.[2] ?? service;
  const vite = VITE_MODE.exec(serviceEntry);
  const declaredMode = vite?.[1];
  const declaredProfile = declaredEnv ?? declaredMode;
  const profile = declaredProfile === 'test' || declaredProfile === 'qa' ? declaredProfile : undefined;
  if (launch.profile !== undefined && launch.profile !== profile)
    throw invalid(
      'The requested test profile conflicts with or is missing from the committed service script',
      launch.source,
    );
  const matched = SERVER_ENTRY.exec(serviceEntry);
  const entry = matched?.[1] ?? matched?.[2] ?? matched?.[3];
  let nodeCommand: PreviewCommand | undefined;
  if (entry !== undefined) {
    const name = relativePath(entry.replace(/^\.\//, ''), false);
    if (!/^[\p{L}\p{N}_. /-]+\.[cm]?[jt]sx?$/u.test(name))
      throw invalid('The service script needs a committed JavaScript or TypeScript entry', launch.source);
    await committed(posix.join(launch.directory, name), true);
    if (declaredEnv !== undefined) {
      const file = `./${name}`;
      nodeCommand = {
        executable: findManager('node', env),
        args: serviceEntry.startsWith('node --watch ') ? ['--watch', file] : [file],
      };
    }
  } else if (vite === null && !FRAMEWORK_SERVICE.test(service)) {
    throw invalid('The script must directly start a supported development server', launch.source);
  }
  let folder = launch.directory;
  const declared = parsed.data?.packageManager;
  const claimed = declared?.split('@')[0];
  if (claimed !== undefined && claimed !== 'npm' && claimed !== 'pnpm' && claimed !== 'yarn' && claimed !== 'bun')
    throw invalid('The committed package manager is not supported', launch.source);
  let manager: 'npm' | 'pnpm' | 'yarn' | 'bun' = claimed ?? 'npm';
  let install: PreviewCommand['args'] = [
    'install',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--ignore-scripts',
  ];
  let hasLock = false;
  for (;;) {
    for (const [name, candidate, args] of LOCKS) {
      if (await committed(posix.join(folder, name), false)) {
        if (claimed !== undefined && claimed !== candidate)
          throw invalid('The committed lockfile and package manager declaration conflict', posix.join(folder, name));
        manager = candidate;
        install =
          manager === 'yarn' && /^yarn@(?:[234]|[5-9]\d*)\./.test(declared ?? '')
            ? ['install', '--immutable', '--mode=skip-builds']
            : [...args];
        hasLock = true;
        break;
      }
    }
    if (hasLock || folder === '.') break;
    folder = posix.dirname(folder);
  }
  const dependencies = [
    parsed.data?.dependencies,
    parsed.data?.devDependencies,
    parsed.data?.optionalDependencies,
  ].some((map) => map !== undefined && Object.keys(map).length > 0);
  if (!hasLock && dependencies && manager !== 'npm')
    throw invalid('Install requires a committed lockfile for this package manager', launch.source);
  const executable = findManager(manager, env);
  const setup =
    hasLock || dependencies
      ? { executable, args: install, directory: join(root, hasLock ? folder : launch.directory) }
      : undefined;
  const bind =
    vite !== null
      ? { host: '--host', extra: ['--strictPort'] }
      : service === 'next dev'
        ? { host: '--hostname', extra: [] }
        : service === 'astro dev' || service === 'nuxt dev'
          ? { host: '--host', extra: [] }
          : null;
  return {
    manager,
    profile,
    nodeEnvironment: declaredEnv ?? 'development',
    command: (port: number) =>
      nodeCommand ?? {
        executable,
        args: [
          'run',
          launch.script,
          ...(bind !== null
            ? [...(manager === 'npm' ? ['--'] : []), bind.host, LOOPBACK, '--port', String(port), ...bind.extra]
            : []),
        ],
      },
    ...(setup === undefined ? {} : { setup }),
  };
}

function mavenUsesSpringBoot(xml: string): boolean {
  const tags: string[] = [];
  let artifact = '';
  let found = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw invalid('The POM must not contain a DOCTYPE');
  });
  parser.on('error', () => {
    throw invalid('The committed pom.xml is not valid XML');
  });
  parser.on('opentag', (tag) => {
    tags.push(tag.local);
    artifact = '';
  });
  parser.on('text', (value) => {
    if (tags.at(-1) === 'artifactId') artifact += value;
  });
  parser.on('closetag', () => {
    if (tags.pop() !== 'artifactId') return;
    found ||=
      (tags.at(-1) === 'plugin' && artifact.trim() === 'spring-boot-maven-plugin') ||
      (tags.at(-1) === 'parent' && artifact.trim() === 'spring-boot-starter-parent');
  });
  parser.write(xml).close();
  return found;
}

async function springCommands(
  launch: FunctionalTestLaunch,
  manifest: string,
  committed: CommittedSource,
  env: NodeJS.ProcessEnv,
) {
  const source = posix.basename(launch.source);
  const maven = source === 'pom.xml' && launch.script === 'spring-boot:run' && mavenUsesSpringBoot(manifest);
  const gradle =
    /^build\.gradle(?:\.kts)?$/.test(source) &&
    launch.script === 'bootRun' &&
    /^\s*id\s*\(?\s*["']org\.springframework\.boot["']/m.test(manifest.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!maven && !gradle)
    throw invalid('Choose a Spring Boot goal declared by a supported Maven or Gradle build file', launch.source);
  await verifySpringProfile(launch, committed, env);
  const executable = await javaBuildExecutable(maven ? 'maven' : 'gradle', launch.directory, committed, env);
  return {
    manager: maven ? ('maven' as const) : ('gradle' as const),
    command: (port: number) => {
      const server = `--server.address=${LOOPBACK} --server.port=${port}`;
      const profile = launch.profile === undefined ? '' : ` --spring.profiles.active=${launch.profile}`;
      return {
        executable,
        args: maven
          ? ['spring-boot:run', `-Dspring-boot.run.arguments=${server}${profile}`]
          : ['bootRun', `--args=${server}${profile}`],
      };
    },
  };
}

export async function resolveTestLaunch(
  worktree: Pick<Worktree, 'path' | 'baseCommit'>,
  proposal: FunctionalTestLaunch,
  inheritedEnv: NodeJS.ProcessEnv,
) {
  const env = projectLaunchEnvironment(inheritedEnv);
  const directory = relativePath(proposal.directory, true);
  const source = relativePath(proposal.source, false);
  if (posix.dirname(source) !== directory)
    throw invalid('Both source and directory are worktree-relative; directory must equal the parent of source', source);
  if (!/^\/(?!\/)[^\\\s?#]*$/.test(proposal.readyPath))
    throw invalid('Choose a configuration file in the launch directory and a local readiness path', source);
  const root = await realpath(worktree.path);
  const { stdout: head } = await runGit(['rev-parse', 'HEAD'], { cwd: root });
  const baseline = worktree.baseCommit;
  if (head !== baseline) throw invalid('The test worktree differs from the selected baseline');
  const dirty = await runGit(['diff', '--quiet', baseline, '--'], { cwd: root, okExitCodes: [0, 1] });
  if (dirty.exitCode !== 0) throw invalid('The test worktree has changes to files in the selected baseline');
  const committed = committedSources(root, baseline);
  const file = await committed(source, true);
  if (file === undefined || file.size > MANIFEST_MAX_BYTES)
    throw invalid('The test launch source is too large', source);
  const manifest = await readFile(file.absolute, 'utf8');
  const launch = { ...proposal, directory, source };
  const commands =
    posix.basename(source) === 'package.json'
      ? await nodeCommands(launch, manifest, root, committed, env)
      : launch.script === FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT
        ? await javaCommands(launch, manifest, file.absolute, committed, env)
        : await springCommands(launch, manifest, committed, env);
  const profile = 'profile' in commands ? commands.profile : launch.profile;
  const evidence: TestLaunchEvidence = {
    ...launch,
    baseline,
    manager: commands.manager,
    ...(profile === undefined ? {} : { profile }),
    ...('javaVersion' in commands && commands.javaVersion !== undefined ? { javaVersion: commands.javaVersion } : {}),
  };
  const resolved: ResolvedTestLaunch = {
    ...commands,
    directory: dirname(file.absolute),
    evidence,
    env: {
      ...('javaEnv' in commands ? commands.javaEnv : env),
      CI: 'true',
      HOST: LOOPBACK,
      HOSTNAME: LOOPBACK,
      SERVER_ADDRESS: LOOPBACK,
      ...('nodeEnvironment' in commands ? { NODE_ENV: commands.nodeEnvironment } : {}),
    },
  };
  return resolved;
}
