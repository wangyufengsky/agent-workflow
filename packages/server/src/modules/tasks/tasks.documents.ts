import type { Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  AppError,
  ARTIFACT_PREVIEW_CHARS,
  type ArtifactRevision,
  type ArtifactVersion,
  AttemptKind,
  AttemptStatus,
  artifactNameSchema,
  DeliveryStatus,
  DiffFileStatus,
  ErrorCode,
  isRepositoryDocumentWorkflow,
  isWritingRepositoryDocument,
  NodeKind,
  NodeStatus,
  REPOSITORY_DOCUMENT_NODE_KEY,
  type RepositoryDocumentDraft,
  TaskStatus,
  WorktreeStatus,
} from '@aw/shared';
import { commitsExist, diffCommits, fileChangedBetween, isAncestor, readFile, runGit } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';
import type { createTaskArtifacts } from './tasks.artifacts.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const documentName = (path: string) =>
  /\.(md|txt)$/i.test(path) && artifactNameSchema.safeParse(basename(path)).success;

function isMissingFile(err: unknown) {
  return err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

async function readDraftFile(cwd: string, path: string, expected: Stats): Promise<RepositoryDocumentDraft | null> {
  const absolute = join(cwd, path);
  if ((await realpath(absolute)) !== absolute) return null;
  const file = await open(absolute, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.ino !== expected.ino || stat.dev !== expected.dev) return null;
    const buffer = Buffer.alloc(Math.min(stat.size, ARTIFACT_PREVIEW_CHARS * 4));
    const { bytesRead } = await file.read(buffer);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return null;
    const text = bytes.toString('utf8');
    return {
      path,
      text: text.slice(0, ARTIFACT_PREVIEW_CHARS),
      truncated: stat.size > bytesRead || text.length > ARTIFACT_PREVIEW_CHARS,
    };
  } finally {
    await file.close();
  }
}

/** A document version is a snapshot of a successful step's Git commit, including for tasks from earlier versions. */
export function createTaskDocuments(
  { nodes, attempts, projects, workflows, worktrees, deliveries, locks }: TasksServiceDeps,
  state: TaskState,
  artifacts: ReturnType<typeof createTaskArtifacts>,
) {
  async function captureManualIntegration(taskId: string, repoPath: string) {
    const task = state.get(taskId);
    const latest = artifacts.visibleVersions(taskId).at(-1);
    const previous = latest?.repository;
    const delivery = deliveries.latest(taskId);
    const worktree = worktrees.findByTask(taskId);
    if (
      task.status !== TaskStatus.Review ||
      latest === undefined ||
      previous === undefined ||
      worktree?.status !== WorktreeStatus.Ready ||
      delivery?.status !== DeliveryStatus.Conflict
    )
      return;

    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: worktree.path })).stdout;
    // The first capture needs evidence that the target was integrated. Subsequent edits build on that capture.
    const base =
      previous.integratedDeliveryId === delivery.id ? previous.commit : `refs/heads/${delivery.targetBranch}`;
    if (commit === previous.commit || !(await isAncestor(repoPath, base, commit))) return;
    if (!(await fileChangedBetween(repoPath, previous.commit, commit, previous.path))) return;
    const object = await runGit(['cat-file', '-t', '--end-of-options', `${commit}:${previous.path}`], {
      cwd: repoPath,
      okExitCodes: [0, 128],
    });
    if (object.exitCode !== 0 || object.stdout !== 'blob') return;
    const file = await readFile(repoPath, commit, previous.path);
    if (!('content' in file)) return;
    await artifacts.saveRepositoryVersion(
      taskId,
      latest.nodeId,
      latest.attemptId,
      {
        path: previous.path,
        commit,
        integratedDeliveryId: delivery.id,
      },
      file.content,
    );
  }

  async function captureDelta(
    repoPath: string,
    taskId: string,
    node: Node,
    base: string,
    commit: string,
    primary: string | undefined,
  ): Promise<string | undefined> {
    const attempt = attempts
      .listByNode(node.id)
      .findLast(({ kind, status }) => kind === AttemptKind.Execute && status === AttemptStatus.Succeeded);
    if (attempt === undefined) return;
    const paths = (await diffCommits(repoPath, base, commit)).filter(
      ({ path, oldPath, status, additions }) =>
        status !== DiffFileStatus.Deleted &&
        additions !== null &&
        documentName(path) &&
        (primary === undefined || primary === path || primary === oldPath),
    );
    const declared = new Set(node.result?.changes?.map(({ path }) => path));
    const named = paths.filter(({ path }) => declared.has(path));
    const candidate = paths.length === 1 ? paths[0] : named.length === 1 ? named[0] : undefined;
    if (candidate === undefined) return;
    const file = await readFile(repoPath, commit, candidate.path);
    if (!('content' in file)) return;
    await artifacts.saveRepositoryVersion(taskId, node.id, attempt.id, { path: candidate.path, commit }, file.content);
    return candidate.path;
  }

  async function draft(taskId: string, nodeId: string): Promise<RepositoryDocumentDraft | null> {
    const task = state.get(taskId);
    const worktree = worktrees.findByTask(taskId);
    if (
      worktree?.status !== WorktreeStatus.Ready ||
      !isRepositoryDocumentWorkflow(workflows.get(task.workflowId)) ||
      !isWritingRepositoryDocument(nodes.detail(taskId, nodeId))
    )
      return null;

    const cwd = worktree.path;
    const patterns = ['--', ':(icase)*.md', ':(icase)*.txt'];
    const [tracked, untracked] = await Promise.all([
      runGit(['diff', '--name-only', '-z', '--diff-filter=ACMRT', 'HEAD', ...patterns], { cwd, verbatim: true }),
      runGit(['ls-files', '--others', '--exclude-standard', '-z', ...patterns], { cwd, verbatim: true }),
    ]);
    const paths = new Set((tracked.stdout + untracked.stdout).split('\0').filter(documentName));
    const primary = artifacts.visibleVersions(taskId).at(-1)?.repository?.path;
    const candidates: { path: string; stat: Stats }[] = [];
    for (const path of paths) {
      if (primary && path !== primary) continue;
      try {
        const stat = await lstat(join(cwd, path));
        if (stat.isFile()) candidates.push({ path, stat });
      } catch (err) {
        if (!isMissingFile(err)) throw err;
      }
    }
    candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const { path, stat } of candidates) {
      try {
        const result = await readDraftFile(cwd, path, stat);
        if (result) return result;
      } catch (err) {
        if (!isMissingFile(err)) throw err;
      }
    }
    return null;
  }

  async function prepare(taskId: string): Promise<void> {
    const task = state.get(taskId);
    if (!isRepositoryDocumentWorkflow(workflows.get(task.workflowId))) return;
    const { repoPath } = projects.getRecord(task.projectId);
    await locks.run(repoPath, async () => {
      const versions = artifacts.visibleVersions(taskId);
      const captured = new Set(versions.map(({ nodeId }) => nodeId));
      let primary = versions.at(-1)?.repository?.path;
      const documentNodes = nodes
        .listByTask(taskId)
        .filter(
          (node) =>
            node.status === NodeStatus.Done &&
            (node.key === REPOSITORY_DOCUMENT_NODE_KEY || node.kind === NodeKind.Revise),
        );
      for (const node of documentNodes) {
        if (captured.has(node.id) || node.commitSha === null) continue;
        const commit = node.commitSha;
        if (!(await commitsExist(repoPath, [commit]))) continue;
        const parent = (await runGit(['rev-parse', `${commit}^1`], { cwd: repoPath })).stdout;
        primary = (await captureDelta(repoPath, taskId, node, parent, commit, primary)) ?? primary;
      }
      // A squash or rebase can leave only the recorded delivery range available for an older completed task.
      if (primary === undefined && task.status === TaskStatus.Completed) {
        const delivery = deliveries.latest(taskId);
        const node = documentNodes.at(-1);
        if (
          node !== undefined &&
          delivery?.status === DeliveryStatus.Succeeded &&
          delivery.diffBase !== null &&
          delivery.diffHead !== null &&
          (await commitsExist(repoPath, [delivery.diffBase, delivery.diffHead]))
        ) {
          await captureDelta(repoPath, taskId, node, delivery.diffBase, delivery.diffHead, undefined);
        }
      }
      await captureManualIntegration(taskId, repoPath);
    });
  }

  async function forDelivery(taskId: string, expectedId: string | undefined): Promise<ArtifactVersion['repository']> {
    const task = state.get(taskId);
    if (!isRepositoryDocumentWorkflow(workflows.get(task.workflowId)) || task.status !== TaskStatus.Review) return;
    await prepare(taskId);
    const latest = artifacts.visibleVersions(taskId).at(-1);
    if (expectedId !== undefined && expectedId !== latest?.id) {
      throw new AppError(ErrorCode.StateTransitionInvalid, 'The document version changed. Review the latest version.');
    }
    return latest?.repository;
  }

  async function assertEditableVersion(input: ArtifactRevision) {
    const document = artifacts.visibleVersions(input.id).at(-1);
    if (document?.id !== input.versionId || document.repository === undefined) return;
    const worktree = worktrees.findByTask(input.id);
    if (worktree?.status !== WorktreeStatus.Ready) return;
    const { commit, path } = document.repository;
    const result = await runGit(['diff', '--quiet', commit, '--', `:(literal)${path}`], {
      cwd: worktree.path,
      okExitCodes: [0, 1],
    });
    if (result.exitCode !== 0)
      throw new AppError(ErrorCode.StateTransitionInvalid, 'The worktree document changed since review', { path });
  }

  return { draft, prepare, forDelivery, assertEditableVersion };
}
