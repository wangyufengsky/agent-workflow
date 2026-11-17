import { basename } from 'node:path';
import {
  AppError,
  type ArtifactRevision,
  type ArtifactVersion,
  AttemptKind,
  AttemptStatus,
  artifactNameSchema,
  DeliveryStatus,
  DiffFileStatus,
  ErrorCode,
  isRepositoryDocumentWorkflow,
  NodeKind,
  NodeStatus,
  REPOSITORY_DOCUMENT_NODE_KEY,
  TaskStatus,
  WorktreeStatus,
} from '@aw/shared';
import { commitsExist, diffCommits, fileChangedBetween, isAncestor, readFile, runGit } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';
import type { createTaskArtifacts } from './tasks.artifacts.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const documentName = (path: string) =>
  /\.(md|txt)$/i.test(path) && artifactNameSchema.safeParse(basename(path)).success;

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
      delivery?.status !== DeliveryStatus.Conflict ||
      previous.integratedDeliveryId === delivery.id
    )
      return;

    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: worktree.path })).stdout;
    const target = `refs/heads/${delivery.targetBranch}`;
    if (commit === previous.commit || !(await isAncestor(repoPath, target, commit))) return;
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

  return { prepare, forDelivery, assertEditableVersion };
}
