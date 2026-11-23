import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { backendCommitter, runGit } from '../git/index.ts';
import { discoverProjectModules } from './discovery.ts';

const repos: string[] = [];
afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { force: true, recursive: true })));
});

async function repository() {
  const repo = await mkdtemp(join(tmpdir(), 'aw-project-modules-'));
  repos.push(repo);
  const git = (...args: string[]) => runGit(args, { cwd: repo }).then(({ stdout }) => stdout);
  async function write(path: string, content: string) {
    const file = join(repo, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  async function commit() {
    await git('add', '--all');
    await git(...backendCommitter(), 'commit', '-m', 'Fixture');
    return git('rev-parse', 'HEAD');
  }
  await git('init', '-b', 'main');
  return { repo, git, write, commit };
}

const modulePom = (name: string, extra = '') => `<project><artifactId>${name}</artifactId>${extra}</project>`;
const javaMain = (extra = '') =>
  `package app;\n${extra}\npublic class App { public static void main(String... args) { } }`;
const service = javaMain('import com.sun.net.httpserver.HttpServer;');
const testClass = 'package app;\nimport org.junit.jupiter.api.Test;\nclass ExampleTest { @Test void itWorks() {} }';
const shared = (content: string) => `<component name="ProjectRunConfigurationManager">${content}</component>`;
const option = (name: string, value: string) => `<option name="${name}" value="${value}" />`;
const launch = (name: string, main: string, extra = '') =>
  `<configuration name="${name}" type="Application">${option('MAIN_CLASS_NAME', main)}${extra}</configuration>`;
const local = (content: string) => `<project><component name="RunManager">${content}</component></project>`;

it('reads tracked discovery evidence from the requested branch and binds only local IDEA hints against its sources', async () => {
  const fixture = await repository();
  const { repo, git, write, commit } = fixture;
  await write(
    'pom.xml',
    modulePom(
      'root',
      '<packaging>pom</packaging><modules><module>app</module><module>jobs</module><module>lib</module></modules>',
    ),
  );
  await write('app/pom.xml', modulePom('app'));
  await write('app/src/main/java/app/App.java', service);
  await write('app/src/test/java/app/ExampleTest.java', testClass);
  await write('app/AGENTS.md', 'Read the [launcher guide](guides/ops.md).');
  await write('app/guides/ops.md', '就绪路径：`/status/ready`');
  await write(
    'jobs/pom.xml',
    modulePom(
      'jobs',
      '<dependencies><dependency><artifactId>spring-batch-core</artifactId></dependency></dependencies>',
    ),
  );
  await write('jobs/src/main/java/app/App.java', javaMain());
  await write('lib/pom.xml', modulePom('lib'));
  await write('lib/src/main/java/app/Helper.java', 'package app; public class Helper {}');
  await write('.run/App.run.xml', shared(launch('Application', 'app.App', '<module name="app.main" />')));
  await write('.run/Ambiguous.run.xml', shared(launch('Ambiguous', 'app.App')));
  await write(
    '.idea/runConfigurations/Maven.xml',
    shared(`
    <configuration name="Module Maven tests" type="MavenRunConfiguration">
      <MavenSettings><option name="myRunnerParameters"><MavenRunnerParameters>
        ${option('myWorkingDirPath', '$PROJECT_DIR$/app')}
        <option name="myGoals"><list><option value="test" /></list></option>
      </MavenRunnerParameters></option></MavenSettings>
    </configuration>`),
  );
  const baseline = await commit();

  await git('switch', '-c', 'feature');
  await write('app/src/main/java/app/App.java', 'package app; class App { }');
  await write('.run/Feature.run.xml', shared(launch('Feature-only', 'app.App', '<module name="jobs.main" />')));
  await commit();
  await write('.idea/workspace.xml', local(launch('Private', 'app.App', '<module name="app.main" />')));
  await write('.run/App.run.xml', shared(launch('Dirty name', 'app.App', '<module name="app.main" />')));

  const status = await git('status', '--porcelain=v1');
  const result = await discoverProjectModules(repo, 'main');
  expect(result.baseline).toBe(baseline);
  expect(await git('branch', '--show-current')).toBe('feature');
  expect(await git('status', '--porcelain=v1')).toBe(status);
  expect(result.warnings).toEqual([expect.stringContaining('"Ambiguous"')]);
  const modules = Object.fromEntries(result.modules.map((module) => [module.directory, module]));
  expect(modules.app).toMatchObject({
    kind: 'service',
    configurations: [
      {
        name: 'Application',
        scope: 'project',
        launch: { source: 'app/pom.xml', readyPath: '/status/ready', mainClass: 'app.App' },
      },
      { name: 'Private', scope: 'local', source: '.idea/workspace.xml' },
    ],
    checks: [
      { kind: 'maven-test', name: 'Module Maven tests', source: '.idea/runConfigurations/Maven.xml' },
      { kind: 'maven-junit', testClass: 'app.ExampleTest' },
    ],
    evidence: expect.arrayContaining([
      'pom.xml',
      'app/AGENTS.md',
      'app/guides/ops.md',
      'app/src/main/java/app/App.java',
    ]),
  });
  expect(modules.jobs).toMatchObject({ kind: 'batch', configurations: [{ mainClass: 'app.App', launch: null }] });
  expect(modules.lib).toMatchObject({ kind: 'library', configurations: [] });
  expect(modules['.']).toMatchObject({ kind: 'unknown', checks: [] });
});

it('finds standalone Java mains, uses named fixed IDEA checks and invalidates verification by fingerprint', async () => {
  const { repo, write, commit } = await repository();
  await write('tools/App.java', service);
  await write('tools/README.md', 'Ready path: /a');
  await write('settings.gradle.kts', 'include(\n  ":svc",\n)\nproject(":svc").projectDir = file("nested/service")');
  await write(
    'nested/service/build.gradle.kts',
    'plugins { java }\ndependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.0") }',
  );
  await write('nested/service/src/test/java/app/ExampleTest.java', testClass);
  await write(
    '.run/Checks.run.xml',
    shared(`
    <configuration name="Service tests" type="GradleRunConfiguration">
      ${option('externalProjectPath', '$PROJECT_DIR$/nested/service')}
      <option name="taskNames"><list><option value="test" /></list></option>
    </configuration>
    <configuration name="Unsupported" type="GradleRunConfiguration">
      ${option('externalProjectPath', '$PROJECT_DIR$/nested/service')}
      ${option('scriptParameters', '--scan')}
      ${option('taskNames', 'test')}
    </configuration>
    <configuration name="Named JUnit" type="JUnit">
      ${option('MAIN_CLASS_NAME', 'app.ExampleTest')}
      ${option('TEST_OBJECT', 'class')}
    </configuration>`),
  );
  await commit();
  const first = await discoverProjectModules(repo, 'main');
  expect(first.modules).toEqual([
    expect.objectContaining({
      directory: 'nested/service',
      evidence: expect.arrayContaining(['settings.gradle.kts']),
      checks: [
        expect.objectContaining({ name: 'Service tests', kind: 'gradle-test', source: '.run/Checks.run.xml' }),
        expect.objectContaining({ name: 'Named JUnit', kind: 'gradle-junit', testClass: 'app.ExampleTest' }),
      ],
    }),
    expect.objectContaining({
      directory: 'tools',
      build: 'standalone',
      kind: 'service',
      configurations: [
        expect.objectContaining({ id: 'main:app.App', launch: expect.objectContaining({ readyPath: '/a' }) }),
      ],
    }),
  ]);
  const oldConfiguration = first.modules.find((module) => module.build === 'standalone')?.configurations[0];
  await write('tools/README.md', 'Ready path: /b');
  await commit();
  const second = await discoverProjectModules(repo, 'main');
  const nextConfiguration = second.modules.find((module) => module.build === 'standalone')?.configurations[0];
  expect(nextConfiguration?.id).toBe(oldConfiguration?.id);
  expect(nextConfiguration?.fingerprint).not.toBe(oldConfiguration?.fingerprint);
  expect(nextConfiguration?.launch?.readyPath).toBe('/b');
});

it('recognizes proprietary service entrypoints from documentation and suggests verified direct dependents', async () => {
  const { repo, write, commit } = await repository();
  await write(
    'api/pom.xml',
    modulePom(
      'api',
      '<dependencies><dependency><groupId>ex</groupId><artifactId>base</artifactId></dependency></dependencies>',
    ),
  );
  await write('api/src/main/java/app/App.java', javaMain());
  await write('api/README.md', 'Module type: HTTP service\nReady path: `/ping`');
  await write(
    'common/pom.xml',
    modulePom('base', '<parent><groupId>ex</groupId><artifactId>parent</artifactId><version>1</version></parent>'),
  );
  await write('common/src/main/java/app/Helper.java', 'package app; public class Helper {}');
  await write('unrelated/pom.xml', modulePom('base', '<groupId>other</groupId>'));
  await write('job/pom.xml', modulePom('job'));
  await write('job/src/main/java/app/App.java', javaMain());
  await write('job/README.md', 'Ready path: /ping');
  await write('.run/Api.run.xml', shared(launch('Start API', 'app.App', '<module name="api.main" />')));
  await write('.run/Job.run.xml', shared(launch('Web service job', 'app.App', '<module name="job.main" />')));
  await write('gradle/settings.gradle.kts', 'include(":common", ":api")');
  await write('gradle/api/build.gradle.kts', 'dependencies {\n  implementation(project(":common"))\n}');
  await write('gradle/common/build.gradle.kts', 'plugins { java }');
  await write('gradle/common/src/main/java/app/Helper.java', 'package app; public class Helper {}');
  await write('another/settings.gradle.kts', 'include(":common")');
  await write('another/common/build.gradle.kts', 'plugins { java }');
  await commit();
  const { modules } = await discoverProjectModules(repo, 'main');
  expect(modules.find((module) => module.id === 'maven:api')).toMatchObject({
    kind: 'service',
    configurations: [{ name: 'Start API', launch: { readyPath: '/ping', mainClass: 'app.App' } }],
  });
  expect(modules.find((module) => module.id === 'maven:job')).toMatchObject({
    kind: 'unknown',
    configurations: [{ name: 'Web service job', launch: null }],
  });
  expect(modules.find((module) => module.id === 'maven:common')?.dependentModules).toEqual(['maven:api']);
  expect(modules.find((module) => module.id === 'gradle:gradle/common')?.dependentModules).toEqual([
    'gradle:gradle/api',
  ]);
  expect(modules.find((module) => module.id === 'maven:unrelated')?.dependentModules).toBeUndefined();
  expect(modules.find((module) => module.id === 'gradle:another/common')?.dependentModules).toBeUndefined();
});
