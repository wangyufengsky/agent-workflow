import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { type DesignStalenessDTO, DesignStalenessState } from '@aw/shared';
import { buildProjectKnowledgeIndex } from './designs.knowledge.ts';
import { designScope } from './designs.planning.ts';
import type { createDesignsRepo, DesignFile, ProjectDesign } from './designs.repo.ts';
import { readDesignGitStatus, type ScannedDesignFile, scanDesignFiles } from './designs.scanner.ts';

const CHANGED_PATHS_SAMPLE_LIMIT = 20;

function changedPaths(baseline: readonly ScannedDesignFile[], current: readonly ScannedDesignFile[]) {
  const remaining = new Map(baseline.map(({ relPath, contentHash }) => [relPath, contentHash]));
  const changed: string[] = [];
  for (const { relPath, contentHash } of current) {
    if (remaining.get(relPath) !== contentHash) changed.push(relPath);
    remaining.delete(relPath);
  }
  return [...changed, ...remaining.keys()].sort((a, b) => a.localeCompare(b, 'en'));
}

function affectedSections(
  repo: ReturnType<typeof createDesignsRepo>,
  design: ProjectDesign,
  files: readonly DesignFile[],
  paths: readonly string[],
) {
  const sections = repo.listSections(design.id);
  const knowledge = buildProjectKnowledgeIndex(design, sections, files, repo.listDiagrams(design.id));
  const changed = new Set(paths);
  const affected = new Set(files.filter(({ relPath }) => changed.has(relPath)).map(({ sectionId }) => sectionId));
  for (const path of paths) {
    for (const id of knowledge.getFileReferences(path).sectionIds) affected.add(id);
  }
  // 即使章节尚未生成，也可按大纲判断哪些范围有文件变化。
  return sections
    .filter(
      (section) =>
        section.selected &&
        (affected.has(section.id) || (section.blocks === null && paths.some(designScope([section])))),
    )
    .map(({ id }) => id);
}

async function readWorktree(repoPath: string) {
  try {
    const root = await realpath(repoPath);
    if (!(await stat(root)).isDirectory()) return undefined;
    await access(root, constants.R_OK | constants.X_OK);
    return { root, status: await readDesignGitStatus(root) };
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
  repo: Pick<ReturnType<typeof createDesignsRepo>, 'listFileHashes'>,
  candidates: readonly ProjectDesign[],
  repoPath: string,
): Promise<ProjectDesign | undefined> {
  const worktree = await readWorktree(repoPath);
  if (worktree === undefined) return undefined;
  // 同一批设计共用一次 Git 状态，相同排除规则共用一次文件扫描。
  const scanned = new Map<string, readonly ScannedDesignFile[]>();
  try {
    for (const design of candidates) {
      if (matchesCleanHead(design, worktree.status)) return design;
      const key = JSON.stringify(design.excludePatterns);
      let current = scanned.get(key);
      if (current === undefined) {
        current = (await scanDesignFiles(worktree.root, design.excludePatterns)).files;
        scanned.set(key, current);
      }
      if (current.length !== design.sourceSnapshot.analyzableCount) continue;
      if (changedPaths(repo.listFileHashes(design.id), current).length === 0) return design;
    }
  } catch (error) {
    if (!directoryUnavailable(error)) throw error;
  }
  return undefined;
}

export async function readDesignStaleness(
  repo: ReturnType<typeof createDesignsRepo>,
  design: ProjectDesign,
  repoPath: string | null,
): Promise<DesignStalenessDTO> {
  const baseSha = design.sourceSnapshot.commitSha;
  const baselineSha = baseSha === null ? {} : { baseSha };
  const empty = { ...baselineSha, changedFilesCount: 0, affectedSectionIds: [], changedPathsSample: [] };
  if (repoPath === null) return { ...empty, state: DesignStalenessState.Unknown, reason: 'project_unbound' };
  const unavailable = { ...empty, state: DesignStalenessState.Unknown, reason: 'directory_unavailable' };
  const worktree = await readWorktree(repoPath);
  if (worktree === undefined) return unavailable;
  const headSha = worktree.status?.commit ?? null;
  const currentSha = headSha === null ? {} : { headSha };
  const fresh = { ...empty, ...currentSha, state: DesignStalenessState.Fresh };
  if (matchesCleanHead(design, worktree.status)) return fresh;

  try {
    const { files: current } = await scanDesignFiles(worktree.root, design.excludePatterns);
    const baseline = repo.listFiles(design.id);
    const changed = changedPaths(baseline, current);
    if (changed.length === 0) return fresh;
    return {
      state: DesignStalenessState.Stale,
      ...baselineSha,
      ...currentSha,
      changedFilesCount: changed.length,
      affectedSectionIds: affectedSections(repo, design, baseline, changed),
      changedPathsSample: changed.slice(0, CHANGED_PATHS_SAMPLE_LIMIT),
    };
  } catch (error) {
    if (directoryUnavailable(error)) return unavailable;
    throw error;
  }
}
