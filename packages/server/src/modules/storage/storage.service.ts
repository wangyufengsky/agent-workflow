import type { Dirent } from 'node:fs';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  ASSISTANT_DIR,
  ATTACHMENTS_DIR,
  type CleanStorageResponse,
  isTerminalState,
  STORAGE_KEEP_DAYS,
  StorageCleanTarget,
  type StorageDTO,
  StorageKind,
  TASK_STATUSES,
  taskMachine,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { DATABASE_FILE } from '../../core/db/database.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';

export type StorageServiceDeps = {
  dataDir: string;
  clock: Clock;
  settings: SettingsService;
  tasks: TasksService;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LOGS_DIR = 'logs';
const RUNS_DIR = 'runs';
const DEFAULT_WORKTREES_DIR = 'worktrees';

/** Top-level entries of the data directory by kind (03 §7); the database comes with its `-wal` / `-shm` files. */
function kindOf(name: string): StorageKind {
  if (name.startsWith(DATABASE_FILE)) return StorageKind.Database;
  switch (name) {
    case LOGS_DIR:
      return StorageKind.Logs;
    case RUNS_DIR:
      return StorageKind.Transcripts;
    case DEFAULT_WORKTREES_DIR:
      return StorageKind.Worktrees;
    case ASSISTANT_DIR:
      return StorageKind.Assistant;
    case ATTACHMENTS_DIR:
      return StorageKind.Attachments;
    default:
      return StorageKind.Other;
  }
}

/** Bytes under `path` without following symbolic links (a worktree's `node_modules` may link elsewhere). */
async function sizeOf(path: string): Promise<number> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch (err) {
    // Recovery with a defined meaning: a file removed while it is counted (a worktree being cleaned up) takes no space.
    if (isNotFound(err)) return 0;
    throw err;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await entriesOf(path)) total += await sizeOf(join(path, entry.name));
  return total;
}

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // A directory that does not exist yet (no logs before the first start, no worktree root before the first task).
    if (isNotFound(err)) return [];
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..');
}

/**
 * Disk usage of the data directory and the worktree root, and the two cleanups (37): old log files and the session
 * records of tasks that ended long ago. Nothing else is deleted here: worktrees go with their task (or from the Git
 * workbench), the database and attachments are the app's records.
 */
export function createStorageService({ dataDir, clock, settings, tasks }: StorageServiceDeps) {
  const terminalStatuses = TASK_STATUSES.filter((s) => isTerminalState(taskMachine, s));
  const worktreeRoot = () => settings.get('worktree.rootDir') ?? join(dataDir, DEFAULT_WORKTREES_DIR);

  /** Log files older than the kept days; the newest file of each kind (`app-`, `opencode-`) is in use and stays. */
  async function oldLogs(): Promise<Array<{ path: string; bytes: number }>> {
    const dir = join(dataDir, LOGS_DIR);
    const files = await Promise.all(
      (await entriesOf(dir))
        .filter((e) => e.isFile())
        .map(async (e) => {
          const path = join(dir, e.name);
          const stat = await lstat(path);
          return { path, kind: e.name.split('-')[0], modified: stat.mtimeMs, bytes: stat.size };
        }),
    );
    const cutoff = clock.now() - STORAGE_KEEP_DAYS * DAY_MS;
    return files.filter(
      (f) => f.modified < cutoff && files.some((other) => other.kind === f.kind && other.modified > f.modified),
    );
  }

  /** `runs/<taskId>/` of tasks that ended before the kept days; their rows, results and branches stay. */
  async function oldTranscripts(): Promise<Array<{ path: string; bytes: number }>> {
    const cutoff = clock.now() - STORAGE_KEEP_DAYS * DAY_MS;
    const ended = tasks.listByStatus(terminalStatuses).filter((t) => t.finishedAt !== null && t.finishedAt < cutoff);
    const dirs = await Promise.all(
      ended.map(async (t) => {
        const path = join(dataDir, RUNS_DIR, t.id);
        return { path, bytes: await sizeOf(path) };
      }),
    );
    return dirs.filter((d) => d.bytes > 0);
  }

  const cleanups = {
    [StorageCleanTarget.Logs]: oldLogs,
    [StorageCleanTarget.Transcripts]: oldTranscripts,
  } as const satisfies Record<StorageCleanTarget, () => Promise<Array<{ path: string; bytes: number }>>>;

  async function usage(): Promise<StorageDTO> {
    const bytes: Record<StorageKind, number> = {
      [StorageKind.Database]: 0,
      [StorageKind.Logs]: 0,
      [StorageKind.Transcripts]: 0,
      [StorageKind.Worktrees]: 0,
      [StorageKind.Assistant]: 0,
      [StorageKind.Attachments]: 0,
      [StorageKind.Other]: 0,
    };
    for (const entry of await entriesOf(dataDir)) bytes[kindOf(entry.name)] += await sizeOf(join(dataDir, entry.name));
    const root = worktreeRoot();
    // A worktree root inside the data directory is already counted with its top-level entry.
    if (!isInside(root, dataDir)) bytes[StorageKind.Worktrees] += await sizeOf(root);
    const items = Object.values(StorageKind).map((kind) => ({ kind, bytes: bytes[kind] }));
    const cleanable = await Promise.all(
      Object.values(StorageCleanTarget).map(async (target) => {
        const found = await cleanups[target]();
        return { target, count: found.length, bytes: found.reduce((sum, f) => sum + f.bytes, 0) };
      }),
    );
    return {
      dataDir,
      worktreeRoot: root,
      items,
      totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
      cleanable,
    };
  }

  return {
    usage,
    async clean(target: StorageCleanTarget): Promise<CleanStorageResponse> {
      const found = await cleanups[target]();
      await Promise.all(found.map((f) => rm(f.path, { recursive: true, force: true })));
      return { freedBytes: found.reduce((sum, f) => sum + f.bytes, 0), storage: await usage() };
    },
  };
}
export type StorageService = ReturnType<typeof createStorageService>;
