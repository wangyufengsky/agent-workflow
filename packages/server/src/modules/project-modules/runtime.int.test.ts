import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ErrorCode, type ProjectJavaModule, type ProjectModuleConfiguration, type ProjectModuleRun } from '@aw/shared';
import pino from 'pino';
import { expect, it, vi } from 'vitest';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { writeFakeExecutable } from '../../../test/helpers/executables.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { systemClock } from '../../core/clock.ts';
import { host } from '../../core/platform.ts';
import { createRepoLocks, listWorktrees } from '../git/index.ts';
import { createModuleRuntime } from './runtime.ts';
import { createRuntimeWorktree } from './runtime-worktree.ts';

const log = pino({ level: 'silent' });
const configuration: ProjectModuleConfiguration = {
  id: 'configuration',
  name: 'Probe',
  source: 'sandbox/Probe.java',
  scope: 'project',
  mainClass: 'Probe',
  directory: 'sandbox',
  review: [],
  fingerprint: 'probe-fingerprint',
  launch: {
    directory: 'sandbox',
    source: 'sandbox/Probe.java',
    mainClass: 'Probe',
    script: 'java-main',
    readyPath: '/health',
  },
};
const module: ProjectJavaModule = {
  id: 'module',
  name: 'Sandbox',
  directory: 'sandbox',
  kind: 'service',
  build: 'standalone',
  configurations: [configuration],
  checks: [],
  evidence: ['sandbox/Probe.java'],
};

function toolEnv(bin: string, javaHome?: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !['PATH', 'JAVA_HOME'].includes(key.toUpperCase())),
  );
  return { ...inherited, PATH: [bin, ...host.pathDirs(process.env)].join(delimiter), JAVA_HOME: javaHome };
}

async function fixture(baseline: string, env = process.env, clock = systemClock) {
  const dataDir = await mkdtemp(join(tmpdir(), 'module-runtime-'));
  const updates: ProjectModuleRun[] = [];
  const locks = createRepoLocks();
  const runtime = createModuleRuntime({ dataDir, clock, env, locks, log, onUpdate: (run) => updates.push(run) });
  const run: ProjectModuleRun = {
    id: 'trial',
    projectId: 'project',
    moduleId: module.id,
    configurationId: configuration.id,
    fingerprint: configuration.fingerprint,
    baseline,
    kind: 'launch',
    checkIds: [],
    status: 'starting',
    startedAt: 1,
    finishedAt: null,
    log: '',
    readyStatus: null,
    readyUrl: null,
  };
  return { dataDir, locks, runtime, run, updates };
}

it('runs the selected baseline in a detached checkout and stops the process before removing it', async () => {
  const javaHome = await mkdtemp(join(tmpdir(), 'module-java-'));
  const javaBin = join(javaHome, 'bin');
  await mkdir(javaBin);
  await writeFakeExecutable(javaBin, 'javac', '');
  await writeFakeExecutable(
    javaBin,
    'java',
    `
    if (process.argv.includes('-version')) {
      console.log('java.version = 21.0.1');
      console.log(${JSON.stringify(`java.home = ${javaHome}`)});
    } else {
      const { createServer } = await import('node:http');
      const { readFile } = await import('node:fs/promises');
      const source = await readFile(process.argv.at(-1), 'utf8');
      createServer((_request, response) => response.end(JSON.stringify({ cwd: process.cwd(), source })))
        .listen(Number(process.env.PORT), '127.0.0.1');
    }
  `,
  );
  const repo = await createTestRepo({
    files: {
      'sandbox/Probe.java': 'class Probe { public static void main(String[] args) {} } // baseline',
    },
  });
  const baseline = await repo.git('rev-parse', 'HEAD');
  await writeFile(join(repo.path, 'sandbox/Probe.java'), 'changed checkout');
  const { runtime, run, updates } = await fixture(baseline, toolEnv(javaBin, javaHome));
  try {
    runtime.start({ repoPath: repo.path, run, module, configuration, checks: [] });
    expect(() => runtime.start({ repoPath: repo.path, run, module, configuration, checks: [] })).toThrow(
      expect.objectContaining({ code: ErrorCode.StateTransitionInvalid }),
    );
    await vi.waitFor(() => expect(runtime.get('project')?.status).toBe('ready'), { timeout: 8_000 });
    const ready = runtime.get('project');
    if (ready?.readyUrl == null) throw new Error('expected a ready URL');
    const response = await fetch(ready.readyUrl);
    expect(await response.json()).toEqual({
      cwd: expect.stringContaining('module-trials'),
      source: expect.stringContaining('// baseline'),
    });
    expect(await listWorktrees(repo.path)).toHaveLength(2);
    await runtime.stop('project', run.id);
    expect(runtime.get('project')).toBeUndefined();
    expect(updates.at(-1)).toMatchObject({ status: 'stopped', finishedAt: expect.any(Number) });
    expect(await listWorktrees(repo.path)).toHaveLength(1);
    await expect(fetch(ready.readyUrl)).rejects.toThrow();
  } finally {
    await runtime.stopAll();
  }
});

it('passes exact JUnit arguments to the discovered build tool and rejects wildcard selectors', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'module-mvn-'));
  await writeFakeExecutable(
    bin,
    'mvn',
    `console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));`,
  );
  const repo = await createTestRepo({
    files: {
      'sandbox/pom.xml': '<project />',
      'sandbox/src/test/java/example/ProbeTest.java': 'package example; class ProbeTest {}',
    },
  });
  const baseline = await repo.git('rev-parse', 'HEAD');
  const { runtime, run, updates } = await fixture(baseline, toolEnv(bin));
  const check = {
    id: 'junit',
    name: 'JUnit',
    kind: 'maven-junit' as const,
    source: 'sandbox/pom.xml',
    testClass: 'example.ProbeTest',
  };
  const javaModule: ProjectJavaModule = { ...module, build: 'maven', checks: [check] };
  const checksRun = {
    ...run,
    kind: 'checks' as const,
    status: 'running' as const,
    configurationId: null,
    checkIds: [check.id],
  };
  try {
    runtime.start({ repoPath: repo.path, run: checksRun, module: javaModule, checks: [check] });
    await vi.waitFor(() => expect(updates.at(-1)).toMatchObject({ status: 'passed' }), { timeout: 8_000 });
    expect(updates.at(-1)?.log).toContain('"argv":["test","-Dtest=example.ProbeTest"]');
    expect(updates.at(-1)?.log).toContain('sandbox');
    expect(await listWorktrees(repo.path)).toHaveLength(1);

    runtime.start({
      repoPath: repo.path,
      run: { ...checksRun, id: 'wildcard' },
      module: javaModule,
      checks: [{ ...check, testClass: 'example.*' }],
    });
    await vi.waitFor(() => expect(updates.at(-1)).toMatchObject({ id: 'wildcard', status: 'failed' }), {
      timeout: 8_000,
    });
    expect(updates.at(-1)?.log).toContain('exact JUnit class');
    expect(updates.at(-1)?.log).not.toContain('"argv"');
  } finally {
    await runtime.stopAll();
  }
});

it('removes registered detached trial worktrees left by an interrupted server', async () => {
  const repo = await createTestRepo();
  const baseline = await repo.git('rev-parse', 'HEAD');
  const { runtime, locks, dataDir } = await fixture(baseline);
  const root = join(dataDir, 'module-trials');
  await createRuntimeWorktree(root, repo.path, baseline, locks);
  expect(await listWorktrees(repo.path)).toHaveLength(2);
  await runtime.recover();
  expect(await listWorktrees(repo.path)).toHaveLength(1);
  expect(await readdir(root)).toEqual([]);
});

it('automatically interrupts a running check and releases its detached worktree', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'module-hanging-mvn-'));
  await writeFakeExecutable(bin, 'mvn', `console.log('test process started'); setInterval(() => {}, 1000);`);
  const repo = await createTestRepo({ files: { 'sandbox/pom.xml': '<project />' } });
  const baseline = await repo.git('rev-parse', 'HEAD');
  const clock = createFakeClock();
  const { runtime, run, updates } = await fixture(baseline, toolEnv(bin), clock);
  const check = { id: 'maven', name: 'Maven', kind: 'maven-test' as const, source: 'sandbox/pom.xml' };
  const javaModule: ProjectJavaModule = { ...module, build: 'maven', checks: [check] };
  const checksRun = {
    ...run,
    kind: 'checks' as const,
    status: 'running' as const,
    configurationId: null,
    checkIds: [check.id],
  };
  try {
    runtime.start({ repoPath: repo.path, run: checksRun, module: javaModule, checks: [check] });
    await vi.waitFor(() => expect(runtime.get(run.projectId)?.log).toContain('test process started'), {
      timeout: 8_000,
    });
    clock.advance(10 * 60_000);
    await vi.waitFor(() => expect(updates.at(-1)).toMatchObject({ status: 'interrupted' }), { timeout: 8_000 });
    expect(updates.at(-1)?.log).toContain('time limit');
    expect(await listWorktrees(repo.path)).toHaveLength(1);
  } finally {
    await runtime.stopAll();
  }
});

it('rejects a run supplied in an invalid initial or terminal state without creating a checkout', async () => {
  const repo = await createTestRepo();
  const baseline = await repo.git('rev-parse', 'HEAD');
  const { runtime, run } = await fixture(baseline);
  for (const status of ['running', 'ready', 'stopped'] as const) {
    expect(() =>
      runtime.start({ repoPath: repo.path, run: { ...run, status }, module, configuration, checks: [] }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.StateTransitionInvalid }));
  }
  expect(runtime.get(run.projectId)).toBeUndefined();
  expect(await listWorktrees(repo.path)).toHaveLength(1);
  await runtime.stopAll();
});
