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
  artifactDocumentKey,
  artifactNameSchema,
  DeliveryStatus,
  DiffFileStatus,
  ErrorCode,
  isRepositoryDocumentWorkflow,
  isWritingRepositoryDocument,
  latestDocumentVersions,
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
  async function captureManualIntegration(taskId: string, repoPath: string, latest: ArtifactVersion) {
    const task = state.get(taskId);
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
        ...previous,
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
    versions: ArtifactVersion[],
    missingPathsOnly = false,
  ): Promise<boolean> {
    const attempt = attempts
      .listByNode(node.id)
      .findLast(({ kind, status }) => kind === AttemptKind.Execute && status === AttemptStatus.Succeeded);
    if (attempt === undefined) return false;
    const paths = await diffCommits(repoPath, base, commit);
    for (const file of paths) {
      if (file.status === DiffFileStatus.Deleted || file.additions === null || !documentName(file.path)) continue;
      if (
        versions.some((v) => v.repository?.path === file.path && (missingPathsOnly || v.repository.commit === commit))
      )
        continue;
      const content = await readFile(repoPath, commit, file.path);
      if (!('content' in content)) continue;
      const previous = versions.findLast((v) => v.repository?.path === (file.oldPath ?? file.path));
      const originalPath = previous && artifactDocumentKey(previous);
      await artifacts.saveRepositoryVersion(
        taskId,
        node.id,
        attempt.id,
        {
          path: file.path,
          commit,
          ...(originalPath && originalPath !== file.path ? { originalPath } : {}),
        },
        content.content,
      );
    }
    return true;
  }

  async function draft(
    taskId: string,
    nodeId: string,
    requestedPath?: string,
  ): Promise<RepositoryDocumentDraft | null> {
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
    const candidates: { path: string; stat: Stats }[] = [];
    for (const path of paths) {
      if (requestedPath && path !== requestedPath) continue;
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

  // 旧版每个节点只保存一份文档，首次查看时按提交补齐其余快照。
  const scanned = new Map<string, string>();
  async function prepare(taskId: string): Promise<void> {
    const task = state.get(taskId);
    if (!isRepositoryDocumentWorkflow(workflows.get(task.workflowId))) return;
    const { repoPath } = projects.getRecord(task.projectId);
    await locks.run(repoPath, async () => {
      let versions = artifacts.visibleVersions(taskId);
      const documentNodes = nodes
        .listByTask(taskId)
        .filter(
          (node) =>
            node.status === NodeStatus.Done &&
            (node.key === REPOSITORY_DOCUMENT_NODE_KEY || node.kind === NodeKind.Revise),
        );
      let missingCommit = false;
      for (const node of documentNodes) {
        if (node.commitSha === null || scanned.get(node.id) === node.commitSha) continue;
        const commit = node.commitSha;
        if (!(await commitsExist(repoPath, [commit]))) {
          missingCommit = true;
          continue;
        }
        const parent = (await runGit(['rev-parse', `${commit}^1`], { cwd: repoPath })).stdout;
        if (await captureDelta(repoPath, taskId, node, parent, commit, versions)) scanned.set(node.id, commit);
        versions = artifacts.visibleVersions(taskId);
      }
      // A squash or rebase can leave only the recorded delivery range available for an older completed task.
      if ((versions.length === 0 || missingCommit) && task.status === TaskStatus.Completed) {
        const delivery = deliveries.latest(taskId);
        const node = documentNodes.at(-1);
        if (
          node !== undefined &&
          delivery?.status === DeliveryStatus.Succeeded &&
          delivery.diffBase !== null &&
          delivery.diffHead !== null &&
          (await commitsExist(repoPath, [delivery.diffBase, delivery.diffHead]))
        ) {
          await captureDelta(repoPath, taskId, node, delivery.diffBase, delivery.diffHead, versions, true);
        }
      }
      if (deliveries.latest(taskId)?.status === DeliveryStatus.Conflict)
        for (const latest of latestDocumentVersions(versions).values())
          await captureManualIntegration(taskId, repoPath, latest);
    });
  }

  async function forDelivery(taskId: string, expectedId: string | undefined) {
    const task = state.get(taskId);
    if (!isRepositoryDocumentWorkflow(workflows.get(task.workflowId)) || task.status !== TaskStatus.Review) return;
    await prepare(taskId);
    const versions = artifacts.visibleVersions(taskId);
    const latest = versions.at(-1);
    if (expectedId !== undefined && expectedId !== latest?.id) {
      throw new AppError(ErrorCode.StateTransitionInvalid, 'The document version changed. Review the latest version.');
    }
    return Array.from(latestDocumentVersions(versions).values()).flatMap((v) => (v.repository ? [v.repository] : []));
  }

  async function assertEditableVersion(input: ArtifactRevision) {
    const document = artifacts.visibleVersions(input.id).find((v) => v.id === input.versionId);
    if (document?.repository === undefined) return;
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
