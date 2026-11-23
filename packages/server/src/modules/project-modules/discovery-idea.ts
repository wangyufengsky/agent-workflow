import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { IdeConfiguration } from '@aw/shared';
import {
  ideaConfigurationReader,
  parseIdeaConfigurations,
  projectPath,
  readIdeaConfigurations,
  visitIdeaXml,
} from '../functional-tests/index.ts';
import { runGit } from '../git/index.ts';
import type { baselineTree } from './discovery-git.ts';

type Tree = Awaited<ReturnType<typeof baselineTree>>;
const IDEA_LIMIT = 96;

export async function discoverIdeaConfigurations(repo: string, tree: Tree, warnings: string[]) {
  async function inspect(path: string, consume: (content: string) => void) {
    if (!tree.files.has(path)) return;
    const xml = await tree.text(path);
    try {
      if (xml === undefined) throw new Error('IDEA XML read limit');
      consume(xml);
    } catch {
      warnings.push(`${path}: could not inspect baseline IDEA configuration`);
    }
  }

  let projectSdk: string | undefined;
  const moduleSdks = new Map<string, string>();
  const imlFiles = new Set<string>();
  await inspect('.idea/misc.xml', (xml) =>
    visitIdeaXml(xml, (path, attrs) => {
      if (path === 'project/component' && attrs.name === 'ProjectRootManager') projectSdk = attrs['project-jdk-name'];
    }),
  );
  await inspect('.idea/modules.xml', (xml) =>
    visitIdeaXml(xml, (path, attrs) => {
      if (path !== 'project/component/modules/module') return;
      const iml = projectPath(attrs.filepath ?? attrs.fileurl?.replace(/^file:\/\//, '') ?? '');
      if (iml?.endsWith('.iml') && imlFiles.size < IDEA_LIMIT) imlFiles.add(iml);
    }),
  );
  for (const iml of imlFiles) {
    await inspect(iml, (xml) =>
      visitIdeaXml(xml, (path, attrs) => {
        if (path === 'module/component/orderEntry' && attrs.type === 'jdk' && attrs.jdkName)
          moduleSdks.set(basename(iml, '.iml'), attrs.jdkName);
      }),
    );
  }

  const sharedPaths = [...tree.files.keys()].filter((path) =>
    /^\.run\/[^/]+\.run\.xml$|^\.idea\/runConfigurations\/[^/]+\.xml$|^\.idea\/workspace\.xml$/.test(path),
  );
  if (sharedPaths.length > IDEA_LIMIT) warnings.push('Baseline IDEA configuration file limit reached');
  const configurations: IdeConfiguration[] = [];
  const tests: IdeaTest[] = [];
  for (const path of sharedPaths.slice(0, IDEA_LIMIT)) {
    await inspect(path, (xml) => {
      tests.push(...parseTestConfigurations(xml, path, 'project'));
    });
    await inspect(path, (xml) =>
      configurations.push(...parseIdeaConfigurations(xml, path, 'worktree', projectSdk, moduleSdks)),
    );
  }

  const { stdout: indexed } = await runGit(['ls-files', '--cached', '-z', '--', '.run', '.idea'], {
    cwd: repo,
    verbatim: true,
  });
  const index = new Set(indexed.split('\0'));
  const isLocal = (path: string) => path === '.idea/workspace.xml' || (!tree.files.has(path) && !index.has(path));
  const local = await readIdeaConfigurations(repo, repo);
  warnings.push(...local.warnings);
  for (const config of local.configurations) {
    if (isLocal(config.source)) configurations.push({ ...config, location: 'project' });
  }
  const localWarnings = new Set<string>();
  const reader = ideaConfigurationReader(await realpath(repo), 'project', localWarnings);
  const localPaths = [
    ...(await reader.configs('.run', '.run.xml')),
    ...(await reader.configs('.idea/runConfigurations', '.xml')),
    '.idea/workspace.xml',
  ];
  for (const path of localPaths) {
    if (isLocal(path)) {
      await reader.xml(path, (xml) => tests.push(...parseTestConfigurations(xml, path, 'local')));
    }
  }
  warnings.push(...localWarnings);
  return { configurations, tests };
}

export type IdeaTest = {
  name: string;
  source: string;
  scope: 'local' | 'project';
  kind: 'maven' | 'gradle' | 'junit';
  directory?: string;
  module?: string;
  testClass?: string;
};

function parseTestConfigurations(xml: string, source: string, scope: IdeaTest['scope']) {
  const configurations: IdeaTest[] = [];
  const component = source === '.idea/workspace.xml' ? 'project/component' : 'component';
  const root = `${component}/configuration`;
  let owner = false;
  let current: IdeaTest | undefined;
  let testObject: string | undefined;
  let goals: string[] = [];
  let goalList: string | undefined;
  let unsupported = false;
  const complete = () => {
    if (!current || unsupported) return;
    if (
      (current.kind === 'junit' && testObject === 'class' && current.testClass) ||
      (current.kind !== 'junit' && goals.length === 1 && goals[0] === 'test')
    )
      configurations.push(current);
  };
  visitIdeaXml(xml, (path, attrs) => {
    if (path === component) {
      complete();
      current = undefined;
      owner = attrs.name === (component === 'component' ? 'ProjectRunConfigurationManager' : 'RunManager');
    }
    if (!owner) return;
    if (path === root) {
      complete();
      current = undefined;
      testObject = undefined;
      unsupported = false;
      goals = [];
      goalList = undefined;
      const kind =
        attrs.type === 'JUnit'
          ? 'junit'
          : attrs.type === 'MavenRunConfiguration'
            ? 'maven'
            : attrs.type === 'GradleRunConfiguration'
              ? 'gradle'
              : undefined;
      if (kind && attrs.name && attrs.default !== 'true' && !attrs['target-name'])
        current = { kind, name: attrs.name.slice(0, 160), source, scope };
    }
    if (!current || !path.startsWith(`${root}/`)) return;
    if (path === `${root}/module` && attrs.name) current.module = attrs.name.slice(0, 200);
    if (/\/(?:envs|envFiles|envFilePaths)\//.test(path)) unsupported = true;
    if (/\/method\/option$/.test(path) && attrs.enabled !== 'false' && attrs.name !== 'Make') unsupported = true;
    if (path === goalList) goalList = undefined;
    if (path.endsWith('/option') && attrs.name === (current.kind === 'maven' ? 'myGoals' : 'taskNames')) {
      goalList = path;
      goals = attrs.value?.trim().split(/\s+/) ?? [];
    }
    if (goalList && [`${goalList}/list/option`, `${goalList}/list/item`].includes(path) && attrs.value !== undefined)
      goals.push(attrs.value.trim());
    if (!path.endsWith('/option')) return;
    const value = attrs.value?.trim();
    if (!value) return;
    if (['TEST_OBJECT', 'TEST_OBJECT_TYPE'].includes(attrs.name ?? '')) testObject = value;
    if (attrs.name === 'MAIN_CLASS_NAME' && current.kind === 'junit') current.testClass = value;
    if (
      ['externalProjectPath', 'myWorkingDirPath', 'workingDirectory', 'WORKING_DIRECTORY'].includes(attrs.name ?? '')
    ) {
      const directory = projectPath(value);
      if (directory !== undefined) current.directory = directory;
      else unsupported = true;
    }
    if (
      [
        'VM_PARAMETERS',
        'PROGRAM_PARAMETERS',
        'scriptParameters',
        'vmOptions',
        'myMultimoduleDir',
        'myProfilesMap',
        'myEnabledProfiles',
        'myDisabledProfiles',
        'ENV_FILE_PATHS',
        'remoteTarget',
      ].includes(attrs.name ?? '')
    )
      unsupported = true;
  });
  complete();
  return configurations;
}
