import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppError, ErrorCode, type ProjectRuntimeCheck, projectRuntimeCheckSchema } from '@aw/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import type { AcceptanceService } from '../acceptance/index.ts';
import { listWorktrees, type RepoLocks, runGit } from '../git/index.ts';
import { RuntimeCleanupError, runProjectRuntimeCheck } from './projects.runtime-worker.ts';
import type { ProjectsService } from './projects.service.ts';
import { projectRuntimeChecksTable } from './projects.table.ts';

type Deps = {
  db: Db;
  clock: Clock;
  env: NodeJS.ProcessEnv;
  locks: RepoLocks;
  projects: ProjectsService;
  acceptance: AcceptanceService;
  dataDir: string;
  log: Logger;
};
type Start = { id: string; branch: string; configVersion: number; runCommand: boolean; runPreview: boolean };

export function createProjectRuntimeService({ db, clock, env, locks, projects, acceptance, dataDir, log }: Deps) {
  const base = join(dataDir, 'runtime-checks');
  const active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  const read = (id: string) => {
    const row = db.select().from(projectRuntimeChecksTable).where(eq(projectRuntimeChecksTable.projectId, id)).get();
    return row === undefined ? null : projectRuntimeCheckSchema.parse(JSON.parse(row.result));
  };
  const save = (value: ProjectRuntimeCheck) => {
    // A deleted project has no result; a worker must still finish cleaning its independent workspace.
    try {
      projects.getRecord(value.projectId);
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.ProjectNotFound) return;
      throw error;
    }
    db.insert(projectRuntimeChecksTable)
      .values({ projectId: value.projectId, result: JSON.stringify(value) })
      .onConflictDoUpdate({ target: projectRuntimeChecksTable.projectId, set: { result: JSON.stringify(value) } })
      .run();
  };
  const pending = () => ({ status: 'pending' as const, output: '' });
  return {
    get(id: string) {
      projects.getRecord(id);
      return read(id);
    },
    start(input: Start) {
      const project = projects.getRecord(input.id);
      if (active.has(input.id)) throw new AppError(ErrorCode.ValidationFailed, 'A runtime check is already running');
      if (project.updatedAt !== input.configVersion)
        throw new AppError(ErrorCode.ValidationFailed, 'Project settings changed; review the commands again');
      const check: ProjectRuntimeCheck = {
        projectId: project.id,
        branch: input.branch,
        configVersion: project.updatedAt,
        checkCommand: input.runCommand ? project.checkCommand : null,
        preview: input.runPreview ? project.preview : null,
        startedAt: clock.now(),
        finishedAt: null,
        status: 'running',
        repository: pending(),
        command:
          input.runCommand && project.checkCommand !== null ? pending() : { status: 'not_configured', output: '' },
        previewResult:
          input.runPreview && project.preview !== null ? pending() : { status: 'not_configured', output: '' },
      };
      save(check);
      const abort = new AbortController();
      const workspaceRoot = join(base, randomUUID());
      const done = (async () => {
        try {
          await mkdir(workspaceRoot, { recursive: true });
          await writeFile(join(workspaceRoot, 'journal.json'), JSON.stringify({ repoPath: project.repoPath }));
          const result = await runProjectRuntimeCheck({
            repoPath: project.repoPath,
            workspaceRoot,
            branch: input.branch,
            checkCommand: check.checkCommand,
            preview: check.preview,
            signal: abort.signal,
            env,
            clock,
            locks,
            runCommand: acceptance.runCommand,
            onProgress(parts) {
              Object.assign(check, {
                repository: parts.repository,
                command: parts.command,
                previewResult: parts.preview,
              });
              save(check);
            },
          });
          Object.assign(check, {
            repository: result.repository,
            command: result.command,
            previewResult: result.preview,
          });
          check.status = abort.signal.aborted ? 'stopped' : 'completed';
        } catch (error) {
          check.status = 'interrupted';
          check.infrastructureError = {
            phase: error instanceof RuntimeCleanupError ? 'cleanup' : 'execution',
            message: (error instanceof Error ? error.message : String(error)).slice(-4000),
          };
          if (check.repository.status === 'pending')
            check.repository = { status: 'failed', output: check.infrastructureError.message };
        } finally {
          check.finishedAt = clock.now();
          try {
            save(check);
          } finally {
            active.delete(project.id);
          }
        }
      })().catch((error: unknown) => {
        log.error({ err: error, projectId: project.id }, 'project runtime check could not be saved');
      });
      active.set(input.id, { abort, done });
      return structuredClone(check);
    },
    stop(id: string) {
      projects.getRecord(id);
      const entry = active.get(id);
      if (entry === undefined) throw new AppError(ErrorCode.ValidationFailed, 'No runtime check is running');
      entry.abort.abort();
      const check = read(id);
      if (check === null) throw new AppError(ErrorCode.ValidationFailed, 'Runtime check no longer exists');
      return check;
    },
    abortProject(id: string) {
      active.get(id)?.abort.abort();
    },
    async stopAll() {
      for (const entry of active.values()) entry.abort.abort();
      await Promise.all([...active.values()].map((entry) => entry.done));
    },
    async recover() {
      await mkdir(base, { recursive: true });
      for (const name of await readdir(base)) {
        if (!/^[a-f0-9-]{36}$/.test(name)) continue;
        const root = join(base, name);
        try {
          const journal: unknown = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
          if (
            typeof journal !== 'object' ||
            journal === null ||
            !('repoPath' in journal) ||
            typeof journal.repoPath !== 'string'
          )
            continue;
          const repoPath = journal.repoPath;
          await locks.run(repoPath, async () => {
            const directory = join(root, 'worktree');
            const worktrees = await listWorktrees(repoPath);
            const actual = await realpath(directory).catch(() => resolve(directory));
            const paths = await Promise.all(
              worktrees.map((worktree) => realpath(worktree.path).catch(() => resolve(worktree.path))),
            );
            if (paths.includes(actual))
              await runGit(['worktree', 'remove', '--force', '--', directory], { cwd: repoPath, env });
          });
          await rm(root, { recursive: true, force: true });
        } catch {
          /* Keep the journal for another startup if the repository is unavailable. */
        }
      }
      for (const row of db.select().from(projectRuntimeChecksTable).all()) {
        const check = projectRuntimeCheckSchema.parse(JSON.parse(row.result));
        if (check.status === 'running') {
          check.status = 'interrupted';
          for (const part of [check.repository, check.command, check.previewResult]) {
            if (part.status === 'pending') part.status = 'stopped';
          }
          check.finishedAt = clock.now();
          save(check);
        }
      }
    },
  };
}
