import { randomUUID } from 'node:crypto';
import {
  AppError,
  defaultProjectModuleOp,
  ErrorCode,
  getProjectModulesOp,
  type ProjectModuleRun,
  type ProjectModules,
  projectModuleRunSchema,
  projectModulesSchema,
  projectModuleVerified,
  rediscoverProjectModulesOp,
  startProjectModuleRunOp,
  stopProjectModuleRunOp,
} from '@aw/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../core/db/database.ts';
import { implement } from '../../core/operations/operations.ts';
import { runGit } from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import { discoverProjectModules } from './discovery.ts';
import { moduleCatalogTable, moduleRunsTable } from './project-modules.table.ts';
import { createModuleRuntime } from './runtime.ts';

const catalogSchema = projectModulesSchema.omit({ runs: true, defaults: true });
const defaultChoices = z.record(z.string(), z.object({ id: z.string(), fingerprint: z.string() }));
const invalid = (message: string) => new AppError(ErrorCode.ValidationFailed, message);
type Deps = Omit<Parameters<typeof createModuleRuntime>[0], 'onUpdate'> & { db: Db; projects: ProjectsService };
export function createProjectModules({ db, projects, ...deps }: Deps) {
  const row = (id: string) => db.select().from(moduleCatalogTable).where(eq(moduleCatalogTable.projectId, id)).get();
  const readRun = (result: string) => projectModuleRunSchema.parse(JSON.parse(result));
  const runtime = createModuleRuntime({
    ...deps,
    onUpdate(run) {
      db.update(moduleRunsTable)
        .set({ result: JSON.stringify(run) })
        .where(eq(moduleRunsTable.id, run.id))
        .run();
    },
  });
  const catalog = (id: string, force: boolean) => {
    const project = projects.getRecord(id);
    return deps.locks.run(project.repoPath, async () => {
      const { defaultBranch: branch, repoPath } = projects.getRecord(id);
      const saved = row(id);
      if (saved && !force) {
        const cached = catalogSchema.parse(JSON.parse(saved.catalog));
        const { stdout } = await runGit(
          ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`],
          { cwd: repoPath },
        );
        if (cached.branch === branch && cached.baseline === stdout) return cached;
      }
      const found = await discoverProjectModules(repoPath, branch);
      const current = { projectId: id, branch, scannedAt: deps.clock.now(), ...found };
      const json = JSON.stringify(current);
      projects.getRecord(id);
      db.insert(moduleCatalogTable)
        .values({ projectId: id, catalog: json })
        .onConflictDoUpdate({ target: moduleCatalogTable.projectId, set: { catalog: json } })
        .run();
      return current;
    });
  };
  function snapshot(current: z.infer<typeof catalogSchema>): ProjectModules {
    const id = current.projectId;
    const stored = row(id);
    const choices = defaultChoices.parse(JSON.parse(stored?.defaults ?? '{}'));
    const defaults: Record<string, string> = {};
    for (const module of current.modules) {
      const selected = choices[module.id];
      if (selected && module.configurations.some((c) => c.id === selected.id && c.fingerprint === selected.fingerprint))
        defaults[module.id] = selected.id;
    }
    const active = runtime.get(id);
    const runs = db
      .select()
      .from(moduleRunsTable)
      .where(eq(moduleRunsTable.projectId, id))
      .orderBy(desc(moduleRunsTable.startedAt), sql`rowid DESC`)
      .all()
      .map((r) => (active?.id === r.id ? active : readRun(r.result)));
    return { ...current, defaults, runs };
  }
  async function get(id: string, force = false) {
    return snapshot(await catalog(id, force));
  }
  async function select(id: string, moduleId: string, configurationId?: string, fingerprint?: string, branch?: string) {
    const current = await get(id, true);
    if (branch !== undefined && branch !== current.branch)
      throw invalid('Module selection belongs to the project default branch');
    const module = current.modules.find((m) => m.id === moduleId);
    const configId = configurationId ?? current.defaults[moduleId];
    const config = module?.configurations.find((c) => c.id === configId);
    if (
      !module ||
      !config?.launch ||
      config.review.length ||
      (fingerprint !== undefined && fingerprint !== config.fingerprint)
    )
      throw invalid('Select a current runnable module configuration');
    return { module, config, current, launch: config.launch };
  }
  async function start(input: z.infer<typeof startProjectModuleRunOp.input>) {
    const { id, moduleId, baseline, configurationId, checkIds, fingerprint } = input;
    const current = await catalog(id, true);
    const module = current.modules.find((m) => m.id === moduleId);
    if (!module || current.baseline !== baseline)
      throw invalid('Project baseline or module changed; refresh module discovery');
    const config = module.configurations.find((c) => c.id === configurationId);
    const checks = module.checks.filter((c) => checkIds?.includes(c.id));
    if (
      checkIds
        ? checks.length !== checkIds.length || configurationId !== undefined || fingerprint !== undefined
        : !config?.launch || config.review.length || config.fingerprint !== fingerprint
    )
      throw invalid('Review the selected module configuration or checks');
    if (runtime.get(id)) throw new AppError(ErrorCode.StateTransitionInvalid, 'Another module run is active');
    const run: ProjectModuleRun = {
      id: randomUUID(),
      projectId: id,
      moduleId,
      baseline,
      configurationId: config?.id ?? null,
      fingerprint: config?.fingerprint ?? baseline,
      kind: checkIds ? 'checks' : 'launch',
      checkIds: checkIds ?? [],
      startedAt: deps.clock.now(),
      finishedAt: null,
      status: checkIds ? 'running' : 'starting',
      readyUrl: null,
      readyStatus: null,
      log: '',
    };
    db.transaction(() => {
      db.insert(moduleRunsTable)
        .values({ id: run.id, projectId: id, startedAt: run.startedAt, result: JSON.stringify(run) })
        .run();
      db.run(sql`DELETE FROM project_module_runs WHERE id IN (
        SELECT id FROM project_module_runs WHERE project_id = ${id}
        AND json_extract(result, '$.moduleId') = ${moduleId}
        AND json_extract(result, '$.configurationId') IS ${config?.id ?? null}
        AND json_extract(result, '$.kind') = ${run.kind}
        AND id != ${run.id} ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET 7
      )`);
      runtime.start({
        repoPath: projects.getRecord(id).repoPath,
        run,
        module,
        checks,
        ...(config ? { configuration: config } : {}),
      });
    });
    return run;
  }
  return {
    select,
    recover: async () => {
      await runtime.recover();
      for (const item of db
        .select()
        .from(moduleRunsTable)
        .where(sql`json_extract(${moduleRunsTable.result}, '$.finishedAt') IS NULL`)
        .all()) {
        const run = readRun(item.result);
        if (run.finishedAt === null)
          db.update(moduleRunsTable)
            .set({ result: JSON.stringify({ ...run, status: 'interrupted', finishedAt: deps.clock.now() }) })
            .where(eq(moduleRunsTable.id, item.id))
            .run();
      }
    },
    stopAll: runtime.stopAll,
    abortProject: runtime.abortProject,
    operations: [
      implement(getProjectModulesOp, ({ id }) => get(id)),
      implement(rediscoverProjectModulesOp, ({ id }) => get(id, true)),
      implement(defaultProjectModuleOp, async ({ id, moduleId, configurationId, fingerprint }) => {
        const { current, config } = await select(id, moduleId, configurationId, fingerprint);
        const last = current.runs.find(
          (r) => r.kind === 'launch' && r.moduleId === moduleId && r.configurationId === config.id,
        );
        if (!last || last.baseline !== current.baseline || !projectModuleVerified(last, config))
          throw invalid('Verify this configuration before setting the default');
        const choices = defaultChoices.parse(JSON.parse(row(id)?.defaults ?? '{}'));
        choices[moduleId] = { id: configurationId, fingerprint };
        db.update(moduleCatalogTable)
          .set({ defaults: JSON.stringify(choices) })
          .where(eq(moduleCatalogTable.projectId, id))
          .run();
        return snapshot(catalogSchema.parse(current));
      }),
      implement(startProjectModuleRunOp, start),
      implement(stopProjectModuleRunOp, async ({ id, runId }) => {
        projects.getRecord(id);
        const stored = db.select().from(moduleRunsTable).where(eq(moduleRunsTable.id, runId)).get();
        if (stored?.projectId !== id) throw new AppError(ErrorCode.NotFound, 'Module run not found');
        await runtime.stop(id, runId);
        const final = db.select().from(moduleRunsTable).where(eq(moduleRunsTable.id, runId)).get();
        if (!final) throw new AppError(ErrorCode.NotFound, 'Module run was removed');
        return readRun(final.result);
      }),
    ],
  };
}
