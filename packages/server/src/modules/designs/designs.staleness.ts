import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { type DesignStalenessDTO, DesignStalenessState } from '@aw/shared';
import { withGitCommitTree } from '../git/index.ts';
import { observeDesignChanges } from './designs.changes.ts';
import type { createDesignsRepo, ProjectDesign } from './designs.repo.ts';
import { readDesignGitStatus, type ScannedDesignFile, scanDesignFiles } from './designs.scanner.ts';

const CHANGED_PATHS_SAMPLE_LIMIT = 20;
type Repo = ReturnType<typeof createDesignsRepo>;

async function readDirectory(repoPath: string) {
  const root = await realpath(repoPath);
  if (!(await stat(root)).isDirectory()) return undefined;
  await access(root, constants.R_OK | constants.X_OK);
  return root;
}

async function readWorktree(repoPath: string) {
  try {
    const root = await readDirectory(repoPath);
    return root === undefined ? undefined : { root, status: await readDesignGitStatus(root) };
  } catch (error) {
    if (directoryUnavailable(error)) return undefined;
    throw error;
  }
}

function directoryUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].some((code) => code === error.code)
  );
}

function matchesCleanHead(design: ProjectDesign, status: Awaited<ReturnType<typeof readDesignGitStatus>>) {
  const { commitSha, dirty } = design.sourceSnapshot;
  return !dirty && status?.clean === true && commitSha === status.commit;
}

export async function findFreshDesign(
  repo: Repo,
  candidates: readonly ProjectDesign[],
  repoPath: string,
): Promise<ProjectDesign | undefined> {
  const worktree = await readWorktree(repoPath);
  if (worktree === undefined) return undefined;
  // 同一批设计共用一次 Git 状态，相同排除规则共用一次文件扫描。
  const scanned = new Map<string, readonly ScannedDesignFile[]>();
  try {
    for (const design of candidates) {
      if (matchesCleanHead(design, worktree.status) && !repo.hasSectionSourceHashes(design.id)) return design;
      const key = JSON.stringify(design.excludePatterns);
      let current = scanned.get(key);
      if (current === undefined) {
        current = (await scanDesignFiles(worktree.root, design.excludePatterns)).files;
        scanned.set(key, current);
      }
      if (observeDesignChanges(repo, design, repo.listFiles(design.id), current).changes.length === 0) return design;
    }
  } catch (error) {
    if (!directoryUnavailable(error)) throw error;
  }
  return undefined;
}

export async function readDesignStaleness(
  repo: Repo,
  design: ProjectDesign,
  repoPath: string | null,
  commitSha?: string,
): Promise<DesignStalenessDTO> {
  const baseSha = design.sourceSnapshot.commitSha;
  const baselineSha = baseSha === null ? {} : { baseSha };
  const empty = { ...baselineSha, changedFilesCount: 0, affectedSectionIds: [], changedPathsSample: [] };
  if (repoPath === null) return { ...empty, state: DesignStalenessState.Unknown, reason: 'project_unbound' };
  const unavailable = { ...empty, state: DesignStalenessState.Unknown, reason: 'directory_unavailable' };
  const freshAt = (headSha: string | null): DesignStalenessDTO => ({
    ...empty,
    ...(headSha === null ? {} : { headSha }),
    state: DesignStalenessState.Fresh,
  });

  async function compare(root: string, headSha: string | null): Promise<DesignStalenessDTO> {
    const fresh = freshAt(headSha);
    const { files: current } = await scanDesignFiles(root, design.excludePatterns);
    const { changes, affectedSectionIds } = observeDesignChanges(repo, design, repo.listFiles(design.id), current);
    if (changes.length === 0) return fresh;
    const changedFilesSample = changes.slice(0, CHANGED_PATHS_SAMPLE_LIMIT);
    return {
      ...fresh,
      state: DesignStalenessState.Stale,
      changedFilesCount: changes.length,
      affectedSectionIds,
      changedPathsSample: changedFilesSample.map(({ relPath }) => relPath),
      changedFilesSample,
    };
  }

  try {
    if (commitSha !== undefined) {
      const root = await readDirectory(repoPath);
      if (root === undefined) return unavailable;
      return await withGitCommitTree(root, commitSha, (target) => compare(target, commitSha));
    }
    const worktree = await readWorktree(repoPath);
    if (worktree === undefined) return unavailable;
    const headSha = worktree.status?.commit ?? null;
    if (matchesCleanHead(design, worktree.status) && !repo.hasSectionSourceHashes(design.id)) return freshAt(headSha);
    return await compare(worktree.root, headSha);
  } catch (error) {
    if (directoryUnavailable(error)) return unavailable;
    throw error;
  }
}
