import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  AppError,
  ATTACHMENT_BYTES_MAX,
  ATTACHMENT_CLEANUP_INTERVAL_MS,
  ATTACHMENT_ORPHAN_TTL_MS,
  ATTACHMENTS_DIR,
  ATTACHMENTS_PER_INPUT_MAX,
  type AttachmentDTO,
  type AttachmentOwnerKind,
  AttachmentSource,
  ErrorCode,
  type SnapshotProjectFileRequest,
  WorktreeStatus,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import { linesOf, locateRepoFile } from '../../core/repo-files.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { WorktreesService } from '../worktrees/index.ts';
import { createAttachmentsRepo, type Owner } from './attachments.repo.ts';

export type AttachmentsServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  projects: ProjectsService;
  worktrees: WorktreesService;
  dataDir: string;
};

const ORIGINAL = 'original';
const tooLarge = (limit: 'bytes' | 'count') =>
  new AppError(ErrorCode.AttachmentTooLarge, `Attachment ${limit} limit exceeded`, {
    limit: limit === 'bytes' ? ATTACHMENT_BYTES_MAX : ATTACHMENTS_PER_INPUT_MAX,
  });

/** Only text is accepted for now (30 §3.1): strict UTF-8 without NUL bytes, whatever the name or MIME type says. */
function asText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(ErrorCode.AttachmentInvalidType, 'Not UTF-8 text');
  }
  if (text.includes('\0')) throw new AppError(ErrorCode.AttachmentInvalidType, 'Not UTF-8 text');
  return text;
}

/** Saves, references and cleans up attachments (30). Owners scope who may see them; this module only checks ids. */
export function createAttachmentsService({
  db,
  unit,
  clock,
  log,
  projects,
  worktrees,
  dataDir,
}: AttachmentsServiceDeps) {
  const repo = createAttachmentsRepo(db);
  const root = join(dataDir, ATTACHMENTS_DIR);
  const dirOf = (id: string) => join(root, id);

  function require(id: string): AttachmentDTO {
    const attachment = repo.find(id);
    if (attachment === undefined)
      throw new AppError(ErrorCode.AttachmentNotFound, `Attachment ${id} not found`, { id });
    return attachment;
  }

  /** The original is complete on disk before its row exists: a row always means a readable attachment (30 §3.1). */
  async function save(attachment: AttachmentDTO, content: string): Promise<AttachmentDTO> {
    const dir = dirOf(attachment.id);
    await mkdir(dir, { recursive: true });
    const partial = join(dir, `${ORIGINAL}.partial`);
    await writeFile(partial, content);
    await rename(partial, join(dir, ORIGINAL));
    repo.insert(attachment);
    return attachment;
  }

  /** The worktree of `taskId` when given, else the project's main working tree (30 §2.1). */
  function rootOf(projectId: string, taskId: string | undefined): string {
    const project = projects.getRecord(projectId);
    if (taskId === undefined) return project.repoPath;
    const worktree = worktrees.findByTask(taskId);
    if (worktree === undefined || worktree.projectId !== projectId || worktree.status !== WorktreeStatus.Ready) {
      throw new AppError(ErrorCode.AttachmentSourceInvalid, 'The task has no worktree in this project', {
        projectId,
        taskId,
      });
    }
    return worktree.path;
  }

  async function cleanup(): Promise<void> {
    const before = clock.now() - ATTACHMENT_ORPHAN_TTL_MS;
    // Rows go first, in one transaction: a send binding the same attachment either committed its reference before
    // (the row is kept) or finds no row (ATTACHMENT_NOT_FOUND); no reference can end up without its original (30 §4).
    const deleted = unit.transact(() => repo.deleteOrphans(before));
    await Promise.all(deleted.map((id) => rm(dirOf(id), { recursive: true, force: true })));
    const known = repo.ids();
    const entries = await readdir(root);
    // Directories without a row: an earlier round failed to remove them, or an upload never completed.
    const leftovers = await Promise.all(
      entries
        .filter((entry) => !known.has(entry))
        .map(async (entry) => ((await stat(join(root, entry))).mtimeMs < before ? entry : undefined)),
    );
    const stale = leftovers.filter((entry) => entry !== undefined);
    await Promise.all(stale.map((entry) => rm(join(root, entry), { recursive: true, force: true })));
    if (deleted.length > 0 || stale.length > 0) {
      log.info({ deleted: deleted.length, removedDirs: stale.length }, 'attachments cleaned up');
    }
  }

  let cancel: (() => void) | undefined;
  let running: Promise<void> | undefined;
  function tick(): void {
    running = (async () => {
      try {
        await cleanup();
      } catch (err) {
        // A failed round leaves its leftovers to the next one (30 §4); a person looks at the log.
        log.error({ err }, 'attachment cleanup failed');
      } finally {
        running = undefined;
      }
    })();
    cancel = clock.schedule(ATTACHMENT_CLEANUP_INTERVAL_MS, tick);
  }

  return {
    /** Ensures the directory exists, then cleans up now and every `ATTACHMENT_CLEANUP_INTERVAL_MS`. */
    async startCleanup(): Promise<void> {
      await mkdir(root, { recursive: true });
      tick();
    },
    stopCleanup(): void {
      cancel?.();
      cancel = undefined;
    },
    /** Resolves once the cleanup in progress, if any, ended. */
    settled: async (): Promise<void> => {
      await running;
    },
    cleanup,

    get: require,
    /** The original's location, for the content route only (never in a DTO). */
    contentPath(id: string): string {
      require(id);
      return join(dirOf(id), ORIGINAL);
    },

    /** One upload (11 §14.1): the body is read up to the size limit and checked before anything is stored. */
    async upload(name: string, body: AsyncIterable<Uint8Array>, declaredBytes: number | undefined) {
      if (declaredBytes !== undefined && declaredBytes > ATTACHMENT_BYTES_MAX) throw tooLarge('bytes');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > ATTACHMENT_BYTES_MAX) throw tooLarge('bytes');
        chunks.push(chunk);
      }
      const content = asText(Buffer.concat(chunks));
      return save(
        {
          id: randomUUID(),
          source: AttachmentSource.Upload,
          name,
          sizeBytes: size,
          origin: null,
          createdAt: clock.now(),
        },
        content,
      );
    },

    /** A snapshot of a project file (30 §2.1): later changes to the file do not change it. */
    async snapshotProjectFile({ projectId, taskId, path, lines }: SnapshotProjectFileRequest): Promise<AttachmentDTO> {
      const file = await locateRepoFile(rootOf(projectId, taskId), path);
      if (typeof file === 'string') {
        throw new AppError(ErrorCode.AttachmentSourceInvalid, `${path} cannot be read`, { path, reason: file });
      }
      if ((await stat(file.real)).size > ATTACHMENT_BYTES_MAX) throw tooLarge('bytes');
      let content = asText(await readFile(file.real));
      if (lines !== undefined) {
        const all = linesOf(content);
        if (lines.to > all.length) {
          throw new AppError(ErrorCode.AttachmentSourceInvalid, 'Line range beyond the end of the file', {
            path,
            lineCount: all.length,
          });
        }
        content = `${all.slice(lines.from - 1, lines.to).join('\n')}\n`;
      }
      const now = clock.now();
      const name = basename(file.relativePath) + (lines === undefined ? '' : `:${lines.from}-${lines.to}`);
      return save(
        {
          id: randomUUID(),
          source: AttachmentSource.ProjectFile,
          name,
          sizeBytes: Buffer.byteLength(content),
          origin: { projectId, taskId: taskId ?? null, path: file.relativePath, lines: lines ?? null, readAt: now },
          createdAt: now,
        },
        content,
      );
    },

    /** Removes an attachment that was not sent; the row before the file, as in `cleanup`. */
    async remove(id: string): Promise<void> {
      unit.transact(() => {
        require(id);
        if (repo.isReferenced(id)) {
          throw new AppError(ErrorCode.ValidationFailed, 'A sent attachment cannot be removed', { id });
        }
        repo.delete(id);
      });
      await rm(dirOf(id), { recursive: true, force: true });
    },

    /**
     * Gives `owner` the attachments in this order; called inside the owner's transaction (30 §5). The owner decides
     * which ids its caller may use (e.g. only the conversation's own).
     */
    bind(owner: Owner, attachmentIds: readonly string[]): void {
      if (attachmentIds.length > ATTACHMENTS_PER_INPUT_MAX) throw tooLarge('count');
      if (new Set(attachmentIds).size !== attachmentIds.length) {
        throw new AppError(ErrorCode.ValidationFailed, 'An attachment is listed twice', { attachmentIds });
      }
      const found = new Set(repo.findMany(attachmentIds).map((a) => a.id));
      const missing = attachmentIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new AppError(ErrorCode.AttachmentNotFound, 'Attachments not found', { ids: missing });
      }
      repo.insertRefs(owner, attachmentIds, clock.now());
    },
    listByOwner: (owner: Owner): AttachmentDTO[] => repo.listByOwner(owner),
    /** Drops the owners' references, in the owner's deleting transaction; the originals go with the next cleanup. */
    release(kind: AttachmentOwnerKind, ownerIds: readonly string[]): void {
      repo.deleteRefs(kind, ownerIds);
    },
  };
}
export type AttachmentsService = ReturnType<typeof createAttachmentsService>;
