import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execa } from 'execa';
import { expect, it } from 'vitest';
import { writeFakeExecutable } from '../../../test/helpers/executables.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { systemClock } from '../../core/clock.ts';
import { host } from '../../core/platform.ts';
import { runIdeaAcceptance } from './idea-acceptance.ts';

async function fixture(files: Record<string, string>) {
  const repo = await createTestRepo({ files });
  const root = await mkdtemp(join(tmpdir(), 'aw-idea-acceptance-'));
  const worktreePath = join(root, 'task');
  await repo.git('worktree', 'add', '--detach', worktreePath, 'HEAD');
  return { repo, root, worktreePath, repoPath: repo.path, clock: systemClock, signal: new AbortController().signal };
}

const junit = (name: string) => `<configuration name="${name}" type="JUnit">
  <option name="MAIN_CLASS_NAME" value="example.NewTest" />
  <option name="TEST_OBJECT" value="class" />
</configuration>`;

it('matches a local IDEA JUnit config to a new working-tree test and does not run a sibling module', async () => {
  const input = await fixture({
    'api/pom.xml': '<project><artifactId>api</artifactId></project>',
    'other/pom.xml': '<project><artifactId>other</artifactId></project>',
    'api/src/test/java/example/OldTest.java': 'package example; import org.junit.jupiter.api.Test; class OldTest {}',
  });
  await mkdir(join(input.repo.path, '.idea'), { recursive: true });
  await writeFile(
    join(input.repo.path, '.idea/workspace.xml'),
    `<project><component name="RunManager">${junit('New test')}</component></project>`,
  );
  const changed = 'api/src/test/java/example/NewTest.java';
  await writeFile(
    join(input.worktreePath, changed),
    'package example; import org.junit.jupiter.api.Test; class NewTest { @Test void works() {} } // dirty fixture',
  );
  const bin = join(input.root, 'bin');
  await mkdir(bin);
  await writeFakeExecutable(
    bin,
    'mvn',
    `
    import { readFile } from 'node:fs/promises';
    console.log(JSON.stringify(process.argv.slice(2)));
    console.log(await readFile('src/test/java/example/NewTest.java', 'utf8'));
    process.exit(1);
  `,
  );
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  env.PATH = [bin, ...host.pathDirs(process.env)].join(delimiter);
  const outcome = await runIdeaAcceptance({ ...input, env, changedPaths: [changed] });
  expect(outcome).toMatchObject({
    kind: 'checked',
    passed: false,
    configurations: ['New test'],
    output: expect.stringContaining('["test","-Dtest=example.NewTest"]'),
  });
  if (outcome.kind !== 'checked') throw new Error('Expected a real check result');
  expect(outcome.output).toContain('dirty fixture');
  for (const uncovered of ['api/src/test/java/example/OldTest.java', 'worker/job.py', 'cmd/app.go']) {
    expect.soft(await runIdeaAcceptance({ ...input, env, changedPaths: [changed, uncovered] })).toMatchObject({
      kind: 'fallback',
    });
  }
  expect(await runIdeaAcceptance({ ...input, env, changedPaths: [changed, 'web/src/app.ts'] })).toMatchObject({
    kind: 'fallback',
  });
  expect(await runIdeaAcceptance({ ...input, env, changedPaths: [changed, 'unknown/Unowned.java'] })).toMatchObject({
    kind: 'fallback',
  });
  expect(await runIdeaAcceptance({ ...input, env: { PATH: '' }, changedPaths: [changed] })).toMatchObject({
    kind: 'fallback',
  });
  const suite = `<configuration name="API suite" type="MavenRunConfiguration">
    <MavenSettings><option name="myRunnerParameters"><MavenRunnerParameters>
      <option name="myWorkingDirPath" value="$PROJECT_DIR$/api"/>
      <option name="myGoals"><list><option value="test"/></list></option>
    </MavenRunnerParameters></option></MavenSettings></configuration>`;
  await writeFile(
    join(input.repo.path, '.idea/workspace.xml'),
    `<project><component name="RunManager">${junit('New test')}${suite}</component></project>`,
  );
  expect(
    await runIdeaAcceptance({ ...input, env, changedPaths: [changed, 'api/src/test/java/example/OldTest.java'] }),
  ).toMatchObject({ kind: 'checked', configurations: ['API suite'], output: expect.stringContaining('["test"]') });
  await writeFile(join(input.repo.path, '.idea/workspace.xml'), '<project><broken');
  expect(await runIdeaAcceptance({ ...input, env, changedPaths: [changed] })).toMatchObject({ kind: 'fallback' });

  await writeFile(
    join(input.repo.path, '.idea/workspace.xml'),
    `<project><component name="RunManager">${junit('New test')}${junit('Ambiguous alias')}</component></project>`,
  );
  expect(await runIdeaAcceptance({ ...input, env, changedPaths: [changed] })).toMatchObject({ kind: 'fallback' });
  expect(await runIdeaAcceptance({ ...input, env, changedPaths: ['web/app.ts'] })).toMatchObject({ kind: 'fallback' });
  expect(
    await runIdeaAcceptance({ ...input, repoPath: join(input.root, 'missing'), env, changedPaths: [changed] }),
  ).toMatchObject({ kind: 'fallback' });
});

async function usableJava() {
  const java = host.findExecutable('java', host.pathDirs(process.env));
  if (java === undefined) return false;
  const result = await execa(java, ['-XshowSettings:properties', '-version'], { reject: false, timeout: 5000 });
  return result.exitCode === 0 && Number(/^\s*java\.version\s*=\s*(\d+)/m.exec(result.stderr)?.[1]) >= 11;
}

const noJava = !(await usableJava());

const java = `import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
class Probe {
  public static void main(String[] args) throws Exception {
    System.out.println("clean-source");
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(System.getProperty("server.port"))), 0);
    server.createContext("/health", ex -> { ex.sendResponseHeaders(204, -1); ex.close(); });
    server.start();
  }
}`;

it.skipIf(noJava)(
  'launches a real IDEA application with the dirty source and releases it after readiness',
  async () => {
    const changed = 'api/Probe.java';
    const input = await fixture({
      [changed]: java,
      'api/README.md': 'Readiness path: /health',
      '.run/Probe.run.xml': `<component name="ProjectRunConfigurationManager"><configuration name="Health" type="Application">
      <option name="MAIN_CLASS_NAME" value="Probe" />
    </configuration></component>`,
    });
    await writeFile(join(input.worktreePath, changed), java.replace('clean-source', 'working-tree-source'));
    const outcome = await runIdeaAcceptance({ ...input, changedPaths: [changed], env: process.env });
    expect(outcome).toMatchObject({
      kind: 'checked',
      passed: true,
      configurations: ['Health'],
      output: expect.stringContaining('HTTP 204'),
    });
    if (outcome.kind !== 'checked') throw new Error('Expected a real readiness result');
    expect(outcome.output).toContain('working-tree-source');
    const port = /-Dserver\.port=(\d+)/.exec(outcome.output)?.[1];
    if (port === undefined) throw new Error('Expected a real readiness port');
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();

    await writeFile(
      join(input.worktreePath, changed),
      java.replace('sendResponseHeaders(204', 'sendResponseHeaders(404'),
    );
    expect(await runIdeaAcceptance({ ...input, changedPaths: [changed], env: process.env })).toMatchObject({
      kind: 'checked',
      passed: false,
      configurations: ['Health'],
      output: expect.stringContaining('HTTP 404'),
    });
  },
);

it.skipIf(noJava)('checks a dirty Compound and starts only the required declared dependency', async () => {
  const changed = 'api/Probe.java';
  const application = (name: string, mainClass: string, extra = '') =>
    `<configuration name="${name}" type="Application"><option name="MAIN_CLASS_NAME" value="${mainClass}"/>${extra}</configuration>`;
  const input = await fixture({
    [changed]: java,
    'api/README.md': 'Readiness path: /health',
    'store/Store.java': java.replace('class Probe', 'class Store'),
    'store/README.md': 'Readiness path: /health',
    '.idea/runConfigurations/Stack.xml': `<component name="ProjectRunConfigurationManager">
      ${application('API', 'Probe', '<envs><env name="STORE_URL" value="http://never-execute.invalid" /></envs>')}
      ${application('Store', 'Store')}
      <configuration name="Stack" type="CompoundRunConfigurationType">
        <toRun name="API" type="Application"/><toRun name="Store" type="Application"/>
      </configuration>
    </component>`,
    '.aw/compound-services.json': JSON.stringify({
      compounds: [
        {
          name: 'Stack',
          target: 'API',
          services: [{ name: 'API', dependsOn: ['Store'], inject: { STORE_URL: 'Store' } }],
        },
      ],
    }),
  });
  const modified = java.replace(
    'System.out.println("clean-source");',
    `
    String store = System.getenv("STORE_URL");
    java.net.HttpURLConnection client = (java.net.HttpURLConnection) new java.net.URL(store + "/health").openConnection();
    if (client.getResponseCode() != 204) throw new IllegalStateException("Store not ready");
    System.out.println("dirty-compound-ok");
  `,
  );
  await writeFile(join(input.worktreePath, changed), modified);
  const outcome = await runIdeaAcceptance({ ...input, changedPaths: [changed], env: process.env });
  expect(outcome).toMatchObject({
    kind: 'checked',
    passed: true,
    configurations: ['Stack'],
    output: expect.stringContaining('dirty-compound-ok'),
  });
  if (outcome.kind !== 'checked') throw new Error('Expected Compound readiness');
  const ports = [...outcome.output.matchAll(/-Dserver\.port=(\d+)/g)].map((match) => match[1]);
  expect(new Set(ports).size).toBe(2);
  for (const port of ports) await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
});
