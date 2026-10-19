import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import {
  AppError,
  type CreateProjectRequest,
  ErrorCode,
  PROJECT_SLUG_MAX,
  type ProjectDetailDTO,
  type ProjectDTO,
  toSlug,
  type UpdateProjectRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import { readDefaultBranch, readOriginUrl, readRepoRoot, runGit } from '../git/index.ts';
import { inferRepoCheckCommand, parseRemoteUrl } from './projects.inference.ts';
import { createProjectsRepo } from './projects.repo.ts';

export type ProjectsServiceDeps = { db: Db; clock: Clock };

/** Fallback slug for names with no ASCII letters or digits (e.g. Chinese names). */
const DEFAULT_SLUG = 'project';

function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = toSlug(name, PROJECT_SLUG_MAX) || DEFAULT_SLUG;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, PROJECT_SLUG_MAX - `-${n}`.length)}-${n}`;
  return slug;
}

/** Resolves `repoPath` to the repository root it names; only a repository's root directory is accepted. */
async function resolveRepoRoot(repoPath: string): Promise<string> {
  if (!isAbsolute(repoPath)) {
    throw new AppError(ErrorCode.ValidationFailed, 'repoPath must be absolute', { repoPath });
  }
  const notRepo = () => new AppError(ErrorCode.ProjectPathNotGitRepo, 'Not the root of a Git repository', { repoPath });
  const isDirectory = await stat(repoPath).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw notRepo();
  const [resolved, root] = await Promise.all([realpath(repoPath), readRepoRoot(repoPath)]);
  if (root === undefined || root !== resolved) throw notRepo();
  return root;
}

export function createProjectsService({ db, clock }: ProjectsServiceDeps) {
  const repo = createProjectsRepo(db);

  function require(id: string): ProjectDTO {
    const project = repo.find(id);
    if (project === undefined) throw new AppError(ErrorCode.ProjectNotFound, `Project ${id} not found`, { id });
    return project;
  }

  async function detail(project: ProjectDTO): Promise<ProjectDetailDTO> {
    const origin = await readOriginUrl(project.repoPath);
    return { ...project, inferredHosting: origin === undefined ? null : parseRemoteUrl(origin) };
  }

  return {
    list: (): ProjectDTO[] => repo.list(),

    get: (id: string): Promise<ProjectDetailDTO> => detail(require(id)),

    async create(input: CreateProjectRequest): Promise<ProjectDetailDTO> {
      const repoPath = await resolveRepoRoot(input.repoPath);
      if (repo.findByRepoPath(repoPath) !== undefined) {
        throw new AppError(ErrorCode.ProjectAlreadyExists, 'Repository already added', { repoPath });
      }
      const defaultBranch = await readDefaultBranch(repoPath);
      if (defaultBranch === undefined) {
        throw new AppError(ErrorCode.GitBaseBranchNotFound, 'HEAD is detached and origin has no default branch', {
          repoPath,
        });
      }
      const name = input.name ?? basename(repoPath);
      const now = clock.now();
      const id = randomUUID();
      repo.insert({
        id,
        name,
        slug: uniqueSlug(name, repo.slugs()),
        repoPath,
        defaultBranch,
        checkCommand: await inferRepoCheckCommand(repoPath),
        createdAt: now,
        updatedAt: now,
      });
      return detail(require(id));
    },

    async update({ id, ...changes }: UpdateProjectRequest): Promise<ProjectDetailDTO> {
      const project = require(id);
      if (changes.defaultBranch !== undefined) {
        const { exitCode } = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${changes.defaultBranch}`], {
          cwd: project.repoPath,
          okExitCodes: [0, 1],
        });
        if (exitCode !== 0) {
          throw new AppError(ErrorCode.GitBaseBranchNotFound, 'Branch does not exist', {
            branch: changes.defaultBranch,
          });
        }
      }
      repo.update(id, { ...changes, updatedAt: clock.now() });
      return detail(require(id));
    },

    delete(id: string): void {
      require(id);
      // TODO(M3-03): refuse with PROJECT_HAS_ACTIVE_TASKS once tasks exist; TODO(M4-05): delete the hosting credential.
      repo.delete(id);
    },
  };
}
export type ProjectsService = ReturnType<typeof createProjectsService>;
