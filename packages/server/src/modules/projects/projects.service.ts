import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import {
  AppError,
  type CreateProjectRequest,
  CredentialKind,
  ErrorCode,
  HostingProvider,
  type HostingRef,
  PROJECT_SLUG_MAX,
  type ProjectDetailDTO,
  type ProjectDTO,
  type SetHostingRequest,
  toSlug,
  type UpdateProjectRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { CredentialsService } from '../credentials/index.ts';
import { branchExists, readDefaultBranch, readOriginUrl, readRepoRoot } from '../git/index.ts';
import { createHostingProvider, type GitHostingProvider, type HostingEndpoints } from '../hosting/index.ts';
import { inferRepoCheckCommand, parseRemoteUrl } from './projects.inference.ts';
import { createProjectsRepo } from './projects.repo.ts';

export type ProjectsServiceDeps = {
  db: Db;
  clock: Clock;
  credentials: CredentialsService;
  /** Platform API addresses (FakeHosting in tests). */
  hosting: HostingEndpoints;
};

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

export function createProjectsService({ db, clock, credentials, hosting }: ProjectsServiceDeps) {
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
    /** The stored project, without the remote inference of `get`. */
    getRecord: require,

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
        if (!(await branchExists(project.repoPath, changes.defaultBranch))) {
          throw new AppError(ErrorCode.GitBaseBranchNotFound, 'Branch does not exist', {
            branch: changes.defaultBranch,
          });
        }
      }
      repo.update(id, { ...changes, updatedAt: clock.now() });
      return detail(require(id));
    },

    /** The tasks module removes the project's tasks first (PROJECT_HAS_ACTIVE_TASKS while any is unfinished). */
    delete(id: string): void {
      require(id);
      const credentialId = repo.hostingCredentialId(id);
      repo.delete(id);
      if (credentialId !== null) credentials.remove(credentialId);
    },

    /** Binds the remote (11 §3) once the platform accepts the token; the token is stored encrypted. */
    async setHosting({ id, provider, baseUrl, repo: path, token }: SetHostingRequest): Promise<ProjectDetailDTO> {
      require(id);
      const ref: HostingRef = {
        provider,
        // github.com has no self-hosted address here; GitLab's is kept without a trailing slash.
        baseUrl: provider === HostingProvider.Github ? null : (baseUrl?.replace(/\/+$/, '') ?? null),
        repo: path,
      };
      await createHostingProvider(ref, token, hosting).verify();
      const existing = repo.hostingCredentialId(id);
      const credentialId = existing ?? (await credentials.create(CredentialKind.GitToken, token));
      if (existing !== null) await credentials.replace(existing, token);
      repo.setHosting(id, { ...ref, credentialId }, clock.now());
      return detail(require(id));
    },

    async clearHosting(id: string): Promise<ProjectDetailDTO> {
      require(id);
      const credentialId = repo.hostingCredentialId(id);
      repo.setHosting(id, null, clock.now());
      if (credentialId !== null) credentials.remove(credentialId);
      return detail(require(id));
    },

    /** The project's platform, signed in with its token; HOSTING_NOT_CONFIGURED when there is none. */
    async hostingOf(id: string): Promise<GitHostingProvider> {
      const project = require(id);
      const credentialId = repo.hostingCredentialId(id);
      if (project.hosting === null || credentialId === null) {
        throw new AppError(ErrorCode.HostingNotConfigured, 'The project is not bound to a hosting repository', { id });
      }
      const { provider, baseUrl, repo: path } = project.hosting;
      return createHostingProvider({ provider, baseUrl, repo: path }, await credentials.reveal(credentialId), hosting);
    },
  };
}
export type ProjectsService = ReturnType<typeof createProjectsService>;
