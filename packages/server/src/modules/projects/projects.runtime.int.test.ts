import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deleteProjectOp,
  getProjectRuntimeCheckOp,
  startProjectRuntimeCheckOp,
  stopProjectRuntimeCheckOp,
  updateProjectOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

it('persists separate real command and preview failures and can rerun after settings change', async () => {
  const { repo, project } = await addProject(t);
  const configured = (
    await t.call(updateProjectOp, {
      id: project.id,
      checkCommand: 'node -e "process.exit(7)"',
      preview: {
        command: 'node -e "process.exit(1)"',
        setupCommand: null,
        readyPath: '/',
        pages: ['/'],
        extraOrigins: [],
      },
    })
  ).body;
  expect(
    (
      await t.call(startProjectRuntimeCheckOp, {
        id: project.id,
        branch: 'main',
        configVersion: configured.updatedAt,
        runCommand: true,
        runPreview: true,
      })
    ).status,
  ).toBe(200);
  await vi.waitFor(
    async () => {
      const result = (await t.call(getProjectRuntimeCheckOp, { id: project.id })).body;
      expect(result?.status).toBe('completed');
      expect(result?.repository.status).toBe('passed');
      expect(result?.command.status).toBe('failed');
      expect(result?.command.reason).toBe('nonzero_exit');
      expect(result?.previewResult.status).toBe('failed');
    },
    { timeout: 10000 },
  );
  expect((await repo.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
  const fixed = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "process.exit(0)"', preview: null })
  ).body;
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: fixed.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () =>
      expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.command.status).toBe('passed'),
    { timeout: 10000 },
  );
});

it('stops a real long running command and cleans its temporary worktree', async () => {
  const { repo, project } = await addProject(t);
  const configured = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "setInterval(() => {}, 1000)"' })
  ).body;
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: configured.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () =>
      expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.repository.status).toBe('passed'),
    { timeout: 10000 },
  );
  expect((await t.call(stopProjectRuntimeCheckOp, { id: project.id })).status).toBe(200);
  await vi.waitFor(
    async () => expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.status).toBe('stopped'),
    { timeout: 10000 },
  );
  expect((await repo.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
});

it('rejects stale settings and restores the latest completed result after restart', async () => {
  const { project } = await addProject(t);
  const first = (await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "process.exit(1)"' })).body;
  const current = (await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "process.exit(0)"' })).body;
  expect(
    (
      await t.call(startProjectRuntimeCheckOp, {
        id: project.id,
        branch: 'main',
        configVersion: first.updatedAt,
        runCommand: true,
        runPreview: false,
      })
    ).status,
  ).toBe(400);
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: current.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () => expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.status).toBe('completed'),
    { timeout: 10000 },
  );
  const dataDir = t.dataDir;
  await t.close();
  t = await createTestApp({ dataDir });
  const saved = (await t.call(getProjectRuntimeCheckOp, { id: project.id })).body;
  expect(saved).toMatchObject({ branch: 'main', configVersion: current.updatedAt, command: { status: 'passed' } });
});

it('classifies a missing command and stops a running check when its project is deleted', async () => {
  const { repo, project } = await addProject(t);
  const missing = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'aw_command_that_does_not_exist_2791' })
  ).body;
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: missing.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () => {
      const check = (await t.call(getProjectRuntimeCheckOp, { id: project.id })).body;
      expect(check?.command.status).toBe('failed');
      expect(check?.command.reason).toBe('cannot_start');
    },
    { timeout: 10000 },
  );
  const running = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "setInterval(() => {}, 1000)"' })
  ).body;
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: running.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () =>
      expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.repository.status).toBe('passed'),
    { timeout: 10000 },
  );
  expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
  await vi.waitFor(
    async () => expect((await repo.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1),
    { timeout: 10000 },
  );
});

it('cleans a journalled abandoned worktree when the app starts again', async () => {
  const { repo } = await addProject(t);
  const dataDir = t.dataDir;
  await t.close();
  const root = join(dataDir, 'runtime-checks', '12345678-1234-1234-1234-123456789abc');
  const worktree = join(root, 'worktree');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'journal.json'), JSON.stringify({ repoPath: repo.path }));
  await repo.git('worktree', 'add', '--detach', '--', worktree, 'main');
  t = await createTestApp({ dataDir });
  expect((await repo.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
});

it('reports cleanup failure after a stopped check and retries the retained journal on restart', async () => {
  const { repo, project } = await addProject(t);
  const configured = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "setInterval(() => {}, 1000)"' })
  ).body;
  await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: configured.updatedAt,
    runCommand: true,
    runPreview: false,
  });
  await vi.waitFor(
    async () =>
      expect((await t.call(getProjectRuntimeCheckOp, { id: project.id })).body?.repository.status).toBe('passed'),
    { timeout: 10000 },
  );
  const moved = `${repo.path}-temporarily-unavailable`;
  await rename(repo.path, moved);
  try {
    await t.call(stopProjectRuntimeCheckOp, { id: project.id });
    await vi.waitFor(
      async () => {
        const result = (await t.call(getProjectRuntimeCheckOp, { id: project.id })).body;
        expect(result?.status).toBe('interrupted');
        expect(result?.infrastructureError).toMatchObject({ phase: 'cleanup', message: expect.any(String) });
      },
      { timeout: 10000 },
    );
  } finally {
    await rename(moved, repo.path);
  }
  const dataDir = t.dataDir;
  await t.close();
  t = await createTestApp({ dataDir });
  expect((await repo.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
});

it('retains reviewed configuration and marks unchecked commands as skipped', async () => {
  const { project } = await addProject(t);
  const preview = {
    command: 'node -e "process.exit(1)"',
    setupCommand: null,
    readyPath: '/',
    pages: ['/'],
    extraOrigins: [],
  };
  const configured = (
    await t.call(updateProjectOp, { id: project.id, checkCommand: 'node -e "process.exit(1)"', preview })
  ).body;
  const started = await t.call(startProjectRuntimeCheckOp, {
    id: project.id,
    branch: 'main',
    configVersion: configured.updatedAt,
    runCommand: false,
    runPreview: false,
  });
  expect(started.body).toMatchObject({
    checkCommand: configured.checkCommand,
    preview,
    command: { status: 'skipped' },
    previewResult: { status: 'skipped' },
  });
  await vi.waitFor(
    async () => {
      const result = (await t.call(getProjectRuntimeCheckOp, { id: project.id })).body;
      expect(result).toMatchObject({
        status: 'completed',
        checkCommand: configured.checkCommand,
        preview,
        repository: { status: 'passed' },
        command: { status: 'skipped' },
        previewResult: { status: 'skipped' },
      });
    },
    { timeout: 10000 },
  );
});

it('logs and retains invalid or inaccessible journals while removing only blank managed directories', async () => {
  const dataDir = t.dataDir;
  await t.close();
  const base = join(dataDir, 'runtime-checks');
  const malformed = '11111111-1111-1111-1111-111111111111';
  const invalid = '22222222-2222-2222-2222-222222222222';
  const unavailable = '33333333-3333-3333-3333-333333333333';
  const missingJournal = '44444444-4444-4444-4444-444444444444';
  const empty = '55555555-5555-5555-5555-555555555555';
  for (const id of [malformed, invalid, unavailable, missingJournal, empty])
    await mkdir(join(base, id), { recursive: true });
  await writeFile(join(base, malformed, 'journal.json'), '{private-secret');
  await writeFile(join(base, invalid, 'journal.json'), JSON.stringify({ repoPath: 42 }));
  await writeFile(
    join(base, unavailable, 'journal.json'),
    JSON.stringify({ repoPath: join(base, 'missing-repository') }),
  );
  await writeFile(join(base, missingJournal, 'unknown-file'), 'keep');
  t = await createTestApp({ dataDir });
  const warnings = t.logs.filter((line) => line.msg === 'project runtime workspace recovery failed');
  expect(warnings).toHaveLength(4);
  expect(warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ workspaceId: malformed, stage: 'validate_journal', code: 'INVALID_JSON' }),
      expect.objectContaining({ workspaceId: invalid, stage: 'validate_journal', code: 'INVALID_JOURNAL' }),
      expect.objectContaining({ workspaceId: unavailable, stage: 'remove_worktree' }),
      expect.objectContaining({ workspaceId: missingJournal, stage: 'read_journal', code: 'ENOENT' }),
    ]),
  );
  expect(JSON.stringify(warnings)).not.toContain('private-secret');
  for (const id of [malformed, invalid, unavailable, missingJournal]) expect(existsSync(join(base, id))).toBe(true);
  expect(existsSync(join(base, empty))).toBe(false);
});
