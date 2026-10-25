import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import {
  AppError,
  type CreateProjectRequest,
  CredentialKind,
  ErrorCode,
  GIT_INIT_BRANCH,
  GIT_INIT_COMMIT_MESSAGE,
  GIT_INIT_LARGE_FILE_BYTES,
  GIT_INIT_LARGE_FILES_SHOWN,
  type GitInitPreviewDTO,
  HostingProvider,
  type HostingRef,
  HostingSource,
  PROJECT_SLUG_MAX,
  type ProjectDetailDTO,
  type ProjectDTO,
  projectBashPatterns,
  type SetHostingRequest,
  toSlug,
  type UpdateProjectRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { CredentialsService } from '../credentials/index.ts';
import type { DatabasesService } from '../databases/index.ts';
import {
  BACKEND_COMMITTER,
  branchExists,
  initRepository,
  listUnignoredFiles,
  type RepoLocks,
  readConfiguredIdentity,
  readDefaultBranch,
  readOriginUrl,
  readRepoRoot,
  runGit,
  stage,
} from '../git/index.ts';
import {
  createHostingProvider,
  type GitHostingProvider,
  type HostingAccountsService,
  type HostingEndpoints,
  normalizeBaseUrl,
} from '../hosting/index.ts';
import { inferDirGitignore, inferRepoCheckCommand, inferRepoPreview, parseRemoteUrl } from './projects.inference.ts';
import { createProjectsRepo } from './projects.repo.ts';

export type ProjectsServiceDeps = {
  db: Db;
  clock: Clock;
  /** Putting a directory under Git takes its lock like any change to a repository's refs (D37). */
  locks: RepoLocks;
  credentials: CredentialsService;
  databases: DatabasesService;
  /** Platform API addresses (FakeHosting in tests). */
  hosting: HostingEndpoints;
  /** Global tokens used when the project has none of its own (D155). */
  hostingAccounts: HostingAccountsService;
};

/** Fallback slug for names with no ASCII letters or digits (e.g. Chinese names). */
const DEFAULT_SLUG = 'project';

function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = toSlug(name, PROJECT_SLUG_MAX) || DEFAULT_SLUG;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, PROJECT_SLUG_MAX - `-${n}`.length)}-${n}`;
  return slug;
}

const notRepo = (repoPath: string) =>
  new AppError(ErrorCode.ProjectPathNotGitRepo, 'Not the root of a Git repository', { repoPath });

/** The directory `repoPath` names, resolved, and the root of the repository it is in (undefined: none). */
async function inspectDirectory(repoPath: string): Promise<{ dir: string; root: string | undefined }> {
  if (!isAbsolute(repoPath)) {
    throw new AppError(ErrorCode.ValidationFailed, 'repoPath must be absolute', { repoPath });
  }
  const isDirectory = await stat(repoPath).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw notRepo(repoPath);
  const [dir, root] = await Promise.all([realpath(repoPath), readRepoRoot(repoPath)]);
  return { dir, root };
}

/**
 * Resolves `repoPath` to the repository root it names; only a repository's root directory is accepted. A directory in
 * no repository can be put under Git instead (D153), hence its own code.
 */
async function resolveRepoRoot(repoPath: string): Promise<string> {
  const { dir, root } = await inspectDirectory(repoPath);
  if (root === undefined) {
    throw new AppError(ErrorCode.ProjectPathNoGit, 'The directory is in no Git repository', { repoPath });
  }
  if (root !== dir) throw notRepo(repoPath);
  return root;
}

/**
 * The directory to put under Git: in no repository, and without a `.git` git could not read (another owner's, a broken
 * one), which a failed initialisation would otherwise remove.
 */
async function resolvePlainDirectory(repoPath: string): Promise<string> {
  const { dir, root } = await inspectDirectory(repoPath);
  if (root === dir) throw new AppError(ErrorCode.ValidationFailed, 'Already a Git repository', { repoPath });
  if (root !== undefined || existsSync(join(dir, '.git'))) throw notRepo(repoPath);
  return dir;
}

/** What the first commit of `dir` would take (D153); `gitignore` is the one to be written. */
async function previewFirstCommit(dir: string, gitignore: string | null): Promise<GitInitPreviewDTO> {
  const paths = await listUnignoredFiles(dir, gitignore);
  const files = await Promise.all(paths.map(async (path) => ({ path, bytes: (await lstat(join(dir, path))).size })));
  if (gitignore !== null) files.push({ path: '.gitignore', bytes: Buffer.byteLength(gitignore) });
  const large = files.filter((f) => f.bytes >= GIT_INIT_LARGE_FILE_BYTES).sort((a, b) => b.bytes - a.bytes);
  return {
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    largeFiles: large.slice(0, GIT_INIT_LARGE_FILES_SHOWN),
    largeFileCount: large.length,
    gitignore,
  };
}

/**
 * `git init` on main, the inferred `.gitignore` unless there is one, and the existing files as the first commit, by the
 * user's identity or agent-workflow's when git has none (D153). On failure the directory is left as it was, so that
 * adding it again starts over rather than finding a repository without commits.
 */
async function putUnderGit(dir: string): Promise<void> {
  const gitignore = await inferDirGitignore(dir);
  await initRepository(dir, GIT_INIT_BRANCH);
  try {
    if (gitignore !== null) await writeFile(join(dir, '.gitignore'), gitignore);
    await stage(dir, ['.']);
    const committer = (await readConfiguredIdentity(dir)) === null ? BACKEND_COMMITTER : [];
    // A directory whose files are all ignored still needs the base commit tasks branch from.
    await runGit([...committer, 'commit', '--quiet', '--allow-empty', '-m', GIT_INIT_COMMIT_MESSAGE], { cwd: dir });
  } catch (e) {
    await rm(join(dir, '.git'), { recursive: true, force: true });
    if (gitignore !== null) await rm(join(dir, '.gitignore'), { force: true });
    throw e;
  }
}

export function createProjectsService({
  db,
  clock,
  locks,
  credentials,
  databases,
  hosting,
  hostingAccounts,
}: ProjectsServiceDeps) {
  const repo = createProjectsRepo(db);

  function require(id: string): ProjectDTO {
    const project = repo.find(id);
    if (project === undefined) throw new AppError(ErrorCode.ProjectNotFound, `Project ${id} not found`, { id });
    return project;
  }

  /** origin's repository; an SSH origin's GitLab address is matched against the saved global ones (D166). */
  function inferHosting(origin: string | undefined): HostingRef | null {
    if (origin === undefined) return null;
    const gitlabAddresses = hostingAccounts
      .list()
      .flatMap((a) => (a.provider === HostingProvider.Gitlab && a.baseUrl !== null ? [a.baseUrl] : []));
    return parseRemoteUrl(origin, gitlabAddresses);
  }

  /**
   * The repository and whose token signs in to it (D155): the project's binding with its token, else that binding's
   * (or origin's) repository with the global token of its platform address.
   */
  async function resolveHosting(project: ProjectDTO): Promise<{ ref: HostingRef; source: HostingSource } | undefined> {
    if (project.hosting?.hasToken === true) {
      const { provider, baseUrl, repo: path } = project.hosting;
      return { ref: { provider, baseUrl, repo: path }, source: HostingSource.Project };
    }
    let ref: HostingRef | null = project.hosting;
    if (ref === null) ref = inferHosting(await readOriginUrl(project.repoPath));
    if (ref === null || !hostingAccounts.has(ref.provider, ref.baseUrl)) return undefined;
    const { provider, baseUrl, repo: path } = ref;
    return { ref: { provider, baseUrl, repo: path }, source: HostingSource.Global };
  }

  /** The project's platform signed in with its own token or the global one (D155); undefined with neither. */
  async function findHosting(id: string): Promise<GitHostingProvider | undefined> {
    const resolved = await resolveHosting(require(id));
    if (resolved === undefined) return undefined;
    const { ref, source } = resolved;
    const credentialId = repo.hostingCredentialId(id);
    const token =
      source === HostingSource.Project && credentialId !== null
        ? await credentials.reveal(credentialId)
        : await hostingAccounts.token(ref.provider, ref.baseUrl);
    if (token === undefined) throw new Error(`The global ${ref.provider} token vanished`);
    return createHostingProvider(ref, token, hosting);
  }

  async function detail(project: ProjectDTO): Promise<ProjectDetailDTO> {
    const origin = await readOriginUrl(project.repoPath);
    const effective = await resolveHosting(project);
    return {
      ...project,
      inferredHosting: inferHosting(origin),
      effectiveHosting: effective === undefined ? null : { ...effective.ref, source: effective.source },
      dbConnectionIds: databases.linkedIds(project.id),
      allowedBash: repo.allowedBash(project.id),
    };
  }

  function assertNotAdded(repoPath: string): void {
    if (repo.findByRepoPath(repoPath) !== undefined) {
      throw new AppError(ErrorCode.ProjectAlreadyExists, 'Repository already added', { repoPath });
    }
  }

  async function add(repoPath: string, name = basename(repoPath)): Promise<ProjectDetailDTO> {
    assertNotAdded(repoPath);
    const defaultBranch = await readDefaultBranch(repoPath);
    if (defaultBranch === undefined) {
      throw new AppError(ErrorCode.GitBaseBranchNotFound, 'HEAD is detached and origin has no default branch', {
        repoPath,
      });
    }
    const now = clock.now();
    const id = randomUUID();
    repo.insert({
      id,
      name,
      slug: uniqueSlug(name, repo.slugs()),
      repoPath,
      defaultBranch,
      checkCommand: await inferRepoCheckCommand(repoPath),
      preview: await inferRepoPreview(repoPath),
      createdAt: now,
      updatedAt: now,
    });
    return detail(require(id));
  }

  return {
    list: (): ProjectDTO[] => repo.list(),
    /** The stored project, without the remote inference of `get`. */
    getRecord: require,

    get: (id: string): Promise<ProjectDetailDTO> => detail(require(id)),

    create: async (input: CreateProjectRequest): Promise<ProjectDetailDTO> =>
      add(await resolveRepoRoot(input.repoPath), input.name),

    /**
     * Refuses a directory `create` would refuse for where it is (no repository, not its root, already added), before
     * the assistant asks the user to confirm adding it (D153).
     */
    async assertAddable(repoPath: string): Promise<void> {
      assertNotAdded(await resolveRepoRoot(repoPath));
    },

    /** Likewise for `initGit`: only a directory in no repository. */
    async assertInitable(repoPath: string): Promise<void> {
      await resolvePlainDirectory(repoPath);
    },

    async previewGitInit(repoPath: string): Promise<GitInitPreviewDTO> {
      const dir = await resolvePlainDirectory(repoPath);
      return previewFirstCommit(dir, await inferDirGitignore(dir));
    },

    /** Puts a directory in no repository under Git, then adds it like `create` (D153). */
    async initGit(input: CreateProjectRequest): Promise<ProjectDetailDTO> {
      const dir = await resolvePlainDirectory(input.repoPath);
      // A second request for the directory would share the new repository and, failing, remove it; under the lock
      // it is checked again and finds the repository the first one made.
      return locks.run(dir, async () => {
        await resolvePlainDirectory(dir);
        await putUnderGit(dir);
        return add(dir, input.name);
      });
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
        baseUrl: normalizeBaseUrl(provider, baseUrl),
        repo: path,
      };
      await createHostingProvider(ref, token, hosting).verify();
      const existing = repo.hostingCredentialId(id);
      const credentialId = existing ?? (await credentials.create(CredentialKind.GitToken, token));
      if (existing !== null) await credentials.replace(existing, token);
      repo.setHosting(id, { ...ref, credentialId }, clock.now());
      return detail(require(id));
    },

    /** Replaces the connections the project's AI sessions may query (11 §3). */
    setDbConnections(id: string, connectionIds: readonly string[]): Promise<ProjectDetailDTO> {
      const project = require(id);
      databases.setProjectLinks(id, connectionIds);
      return detail(project);
    },

    /** Bash patterns the project's later AI sessions run without asking (D101). */
    allowedBash: (id: string): string[] => repo.allowedBash(id),

    /** 「总是允许」on a bash request of one of the project's sessions: its commands with their leading options (D101). */
    rememberBash(id: string, commands: readonly string[]): void {
      repo.addAllowedBash(id, projectBashPatterns(commands), clock.now());
    },

    /** Later sessions ask again; the sessions already running keep their rules (D35). */
    removeAllowedBash(id: string, pattern: string): Promise<ProjectDetailDTO> {
      const project = require(id);
      repo.removeAllowedBash(id, pattern);
      return detail(project);
    },

    async clearHosting(id: string): Promise<ProjectDetailDTO> {
      require(id);
      const credentialId = repo.hostingCredentialId(id);
      repo.setHosting(id, null, clock.now());
      if (credentialId !== null) credentials.remove(credentialId);
      return detail(require(id));
    },

    findHosting,

    /** The project's platform signed in (D155); HOSTING_NOT_CONFIGURED when it has no token, own or global. */
    async hostingOf(id: string): Promise<GitHostingProvider> {
      const found = await findHosting(id);
      if (found === undefined) {
        throw new AppError(ErrorCode.HostingNotConfigured, 'The project has no hosting token', { id });
      }
      return found;
    },
  };
}
export type ProjectsService = ReturnType<typeof createProjectsService>;
