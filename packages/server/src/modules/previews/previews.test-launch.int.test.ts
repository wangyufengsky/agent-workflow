import { chmod, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErrorCode,
  type FunctionalTestLaunch,
  Platform,
  PreviewState,
  ServerEventType,
  updateProjectOp,
} from '@aw/shared';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { host } from '../../core/platform.ts';

const launch: FunctionalTestLaunch = {
  directory: 'api',
  source: 'api/package.json',
  script: 'serve:test',
  readyPath: '/health',
};
const manifest = JSON.stringify({
  name: 'preview-fixture',
  scripts: {
    'serve:test': 'node server.mjs',
    'serve:qa': 'cross-env NODE_ENV=qa node server.mjs',
    'dev:test': 'vite --mode test',
    start: 'node -e "process.exit(0)"',
    deploy: 'node server.mjs',
    dev: 'node server.mjs',
    predev: 'npm publish',
  },
});
const server = `import { createServer } from 'node:http';
let probes = 0;
createServer((req, res) => {
  if (req.url === '/missing') { res.writeHead(404).end(); return; }
  if (req.url === '/health' && ++probes === 1) { res.writeHead(503).end(); return; }
  res.end(JSON.stringify({ path: req.url, dir: process.cwd(), port: process.env.PORT, host: process.env.HOST, profile: process.env.NODE_ENV, probes }));
}).listen(Number(process.env.PORT), process.env.HOST);
`;

let t: TestApp;
afterEach(async () => t.close());

async function testWorktree(files: Record<string, string> = {}, wrapper?: { name: string; executable: string }) {
  t = await createTestApp();
  const wrapperFile =
    wrapper === undefined
      ? {}
      : {
          [wrapper.name]: `#!/bin/sh
test "${'$'}{PWD##*/}" = api || exit 8
printf "%s" "$PWD" > .test-wrapper-directory
exec "${wrapper.executable}" "$@"
`,
        };
  const { project, repo } = await addProject(t, {
    files: { 'api/package.json': manifest, 'api/server.mjs': server, ...files, ...wrapperFile },
  });
  if (wrapper !== undefined) {
    await chmod(join(repo.path, wrapper.name), 0o755);
    await repo.git('add', '--chmod=+x', '--', wrapper.name);
    await repo.git('commit', '-m', 'Make root wrapper executable');
  }
  const ready = taskReaches(t, 'plan_review');
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', checkpoints: { confirm_plan: true } });
  await ready;
  const worktree = t.app.services.worktrees.findByTask(task.id);
  if (worktree === undefined) throw new Error('Test worktree is missing');
  return { project, task, worktree };
}

it('从提交的子目录启动测试服务，保存真实命令，并保持既有预览选择与并发一致', async () => {
  const { project, task, worktree } = await testWorktree();
  const previews = t.app.services.previews;
  expect(await previews.resolveTestLaunch(task.id, launch)).toEqual({
    ...launch,
    baseline: worktree.baseCommit,
    manager: 'npm',
  });

  await t.call(updateProjectOp, {
    id: project.id,
    preview: {
      command: 'node api/server.mjs',
      setupCommand: null,
      readyPath: '/',
      pages: ['/'],
      extraOrigins: [],
    },
  });
  const userOwned = await previews.start(task.id);
  await expect(previews.start(task.id, { launch })).rejects.toMatchObject({ code: ErrorCode.StateTransitionInvalid });
  expect(previews.get(task.id).url).toBe(userOwned.url);
  await previews.stop(task.id);

  const started = waitForEvent(
    t.app.events,
    ServerEventType.PreviewUpdated,
    ({ taskId, state }) => taskId === task.id && state === PreviewState.Starting,
  );
  const [running] = await Promise.all([
    previews.start(task.id, { launch }),
    previews.start(task.id, { launch }),
    (async () => {
      await started;
      await expect(previews.start(task.id, { launch: { ...launch, script: 'serve:qa' } })).rejects.toMatchObject({
        code: ErrorCode.StateTransitionInvalid,
      });
    })(),
  ]);
  expect(running.state).toBe(PreviewState.Running);
  const details = previews.launchDetails(task.id);
  expect(details).toMatchObject({
    command: expect.stringMatching(/^npm(?:\.exe|\.cmd)? run serve:test$/),
    readyUrl: `${running.url}/health`,
    readyStatus: 200,
    evidence: { ...launch, baseline: worktree.baseCommit, manager: 'npm' },
  });
  if (details === undefined) throw new Error('No launch details');
  expect(await (await fetch(details.readyUrl)).json()).toMatchObject({
    path: '/health',
    dir: await realpath(join(worktree.path, 'api')),
    port: new URL(details.readyUrl).port,
    host: '127.0.0.1',
    probes: 3,
  });
  expect((await previews.start(task.id)).url).toBe(running.url);
  await previews.stop(task.id);
  await expect(fetch(details.readyUrl)).rejects.toThrow();
  const tested = { ...launch, script: 'serve:qa', profile: 'qa' as const };
  expect(await previews.resolveTestLaunch(task.id, { ...launch, script: 'dev:test', profile: 'test' })).toMatchObject({
    profile: 'test',
    script: 'dev:test',
  });
  await expect(previews.resolveTestLaunch(task.id, { ...tested, profile: 'test' })).rejects.toMatchObject({
    code: ErrorCode.ValidationFailed,
  });
  const qa = await previews.start(task.id, { launch: tested });
  expect(await (await fetch(`${qa.url}/health`)).json()).toMatchObject({ profile: 'qa' });
  expect(previews.launchDetails(task.id)).toMatchObject({
    command: expect.stringMatching(/^node(?:\.exe)? \.\/server\.mjs$/),
    evidence: tested,
  });
  await previews.stop(task.id);
  await expect(previews.start(task.id, { launch: { ...launch, readyPath: '/missing' } })).rejects.toMatchObject({
    code: ErrorCode.PreviewStartFailed,
    details: { readyStatus: 404 },
  });
  expect(previews.launchDetails(task.id)).toMatchObject({
    readyStatus: 404,
    readyUrl: expect.stringMatching(/\/missing$/),
  });
});

it('拒绝无提交证据、越界、符号链接、非服务脚本和未声明的 Spring profile', async () => {
  const { task, worktree } = await testWorktree({
    'pom.xml':
      '<project><build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>',
    'prod/pom.xml':
      '<project><build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>',
    'prod/src/main/resources/application.properties': 'spring.profiles.active=production\n',
  });
  const previews = t.app.services.previews;
  for (const proposal of [
    { ...launch, source: '../package.json' },
    { ...launch, source: '/etc/package.json' },
    { ...launch, script: 'deploy' },
    { ...launch, script: 'dev' },
    { ...launch, script: 'start' },
    { ...launch, readyPath: '//other.test/' },
    { ...launch, profile: 'qa' as const },
    { directory: '.', source: 'pom.xml', script: 'spring-boot:run', profile: 'qa' as const, readyPath: '/' },
  ]) {
    await expect(previews.resolveTestLaunch(task.id, proposal)).rejects.toMatchObject({
      code: ErrorCode.ValidationFailed,
    });
  }
  await expect(
    previews.resolveTestLaunch(task.id, {
      directory: 'prod',
      source: 'prod/pom.xml',
      script: 'spring-boot:run',
      readyPath: '/',
    }),
  ).rejects.toMatchObject({ code: ErrorCode.ValidationFailed, message: expect.stringContaining('production') });
  await writeFile(join(worktree.path, 'api/package.json'), '{}');
  await expect(previews.resolveTestLaunch(task.id, launch)).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  await writeFile(join(worktree.path, 'api/package.json'), manifest);
  if (host.os !== Platform.Win32) {
    await symlink(join(worktree.path, 'api'), join(worktree.path, 'alias'));
    await expect(
      previews.resolveTestLaunch(task.id, { ...launch, directory: 'alias', source: 'alias/package.json' }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  }
  expect(previews.get(task.id).state).toBe(PreviewState.Stopped);
});

it('没有锁文件的 npm 子包从对应子目录安装本地依赖', async () => {
  const { task } = await testWorktree({
    'api/package.json': JSON.stringify({
      name: 'preview-root',
      scripts: { 'serve:test': 'node server.mjs' },
      dependencies: { 'fixture-runtime': 'file:vendor/runtime' },
    }),
    'api/vendor/runtime/package.json': JSON.stringify({ name: 'fixture-runtime', version: '1.0.0', main: 'index.cjs' }),
    'api/vendor/runtime/index.cjs': "module.exports = 'installed from the service directory';",
    'api/server.mjs': `import { createServer } from 'node:http';
import value from 'fixture-runtime';
createServer((_, res) => res.end(value)).listen(Number(process.env.PORT), process.env.HOST);
`,
  });
  const preview = await t.app.services.previews.start(task.id, { launch });
  expect(await (await fetch(`${preview.url}/health`)).text()).toBe('installed from the service directory');
});

it.skipIf(!process.env.JAVA8_HOME && !process.env.AW_TEST_REGISTERED_JDK8)(
  'uses Java 8 and adds only the requested Maven provided dependencies',
  async () => {
    const { task, worktree } = await testWorktree(
      {
        'api/pom.xml': `<project xmlns="http://maven.apache.org/POM/4.0.0">
      <modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>qa</artifactId><version>1</version>
      <properties><maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target></properties>
      <dependencies>
        <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.14.0</version><scope>provided</scope></dependency>
        <dependency><groupId>commons-io</groupId><artifactId>commons-io</artifactId><version>2.15.1</version><scope>runtime</scope></dependency>
        <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency>
      </dependencies>
    </project>`,
        'api/src/main/java/example/Probe.java': `package example;
      import com.sun.net.httpserver.HttpServer;
      import java.net.InetSocketAddress;
      import java.nio.charset.StandardCharsets;
      class Probe {
        public static void main(String[] args) throws Exception {
          String details = System.getProperty("java.specification.version") + "," +
            present("org.apache.commons.lang3.StringUtils") + "," +
            present("org.apache.commons.io.IOUtils") + "," +
            present("org.junit.Test");
          String serverPort = System.getProperty("server.port");
          if (!serverPort.equals(System.getenv("PORT")) || !serverPort.equals(System.getenv("SERVER_PORT"))) {
            throw new IllegalStateException("the JVM property and environment disagree");
          }
          HttpServer server = HttpServer.create(new InetSocketAddress(System.getProperty("server.address"), Integer.parseInt(serverPort)), 0);
          server.createContext("/health", exchange -> {
            byte[] bytes = details.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
          });
          server.start();
        }
        private static boolean present(String name) {
          try { Class.forName(name); return true; }
          catch (ClassNotFoundException missing) { return false; }
        }
      }`,
      },
      process.env.AW_TEST_MAVEN_ROOT_WRAPPER === undefined
        ? undefined
        : {
            name: 'mvnw',
            executable: process.env.AW_TEST_MAVEN_ROOT_WRAPPER,
          },
    );
    const previews = t.app.services.previews;
    const proposal: FunctionalTestLaunch = {
      directory: 'api',
      source: 'api/pom.xml',
      script: 'java-main',
      mainClass: 'example.Probe',
      javaVersion: 8,
      readyPath: '/health',
    };
    for (const includeProvided of [false, true]) {
      await previews.start(task.id, { launch: { ...proposal, includeProvided } });
      if (process.env.AW_TEST_MAVEN_ROOT_WRAPPER !== undefined)
        expect(await readFile(join(worktree.path, 'api', '.test-wrapper-directory'), 'utf8')).toBe(
          join(worktree.path, 'api'),
        );
      const details = previews.launchDetails(task.id);
      if (details === undefined) throw new Error('Expected Java launcher evidence');
      expect(details.evidence).toMatchObject({ javaVersion: 8, includeProvided });
      expect(await (await fetch(details.readyUrl)).text()).toBe(`1.8,${includeProvided},true,false`);
      await previews.stop(task.id);
    }
  },
  120_000,
);

it.skipIf(!process.env.AW_TEST_GRADLE)(
  'launches the selected Gradle class even when the run task overrides its main class',
  async () => {
    const { task, worktree } = await testWorktree(
      {
        'settings.gradle': "rootProject.name = 'preview'; include 'api'",
        'api/build.gradle': `plugins { id 'application' }
      application { mainClass = 'example.Probe' }
      tasks.named('run') { mainClass = 'example.Other' }`,
        'api/src/main/java/example/Other.java': `package example;
      public class Other { public static void main(String[] args) { throw new AssertionError("Wrong main class"); } }`,
        'api/src/main/java/example/Probe.java': `package example;
      import com.sun.net.httpserver.HttpServer;
      import java.net.InetSocketAddress;
      class Probe {
        public static void main(String[] args) throws Exception {
          HttpServer server = HttpServer.create(new InetSocketAddress(System.getProperty("server.address"), Integer.parseInt(System.getProperty("server.port"))), 0);
          server.createContext("/health", exchange -> { exchange.sendResponseHeaders(204, -1); exchange.close(); });
          server.start();
        }
      }`,
      },
      process.env.AW_TEST_GRADLE_ROOT_WRAPPER === undefined
        ? undefined
        : {
            name: 'gradlew',
            executable: process.env.AW_TEST_GRADLE_ROOT_WRAPPER,
          },
    );
    const previews = t.app.services.previews;
    await previews.start(task.id, {
      launch: {
        directory: 'api',
        source: 'api/build.gradle',
        script: 'java-main',
        javaVersion: 21,
        mainClass: 'example.Probe',
        readyPath: '/health',
      },
    });
    if (process.env.AW_TEST_GRADLE_ROOT_WRAPPER !== undefined)
      expect(await readFile(join(worktree.path, 'api', '.test-wrapper-directory'), 'utf8')).toBe(
        join(worktree.path, 'api'),
      );
    const details = previews.launchDetails(task.id);
    if (details === undefined) throw new Error('Expected Gradle launcher evidence');
    expect(details.evidence).toMatchObject({ manager: 'gradle', javaVersion: 21 });
    expect(details.command).toContain('example.Probe');
    expect((await fetch(details.readyUrl)).status).toBe(204);
  },
  120_000,
);
