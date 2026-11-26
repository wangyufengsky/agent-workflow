import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { type DesignStalenessDTO, DesignStalenessState } from '@aw/shared';
import { buildProjectKnowledgeIndex } from './designs.knowledge.ts';
import { designScope } from './designs.planning.ts';
import type { createDesignsRepo, DesignFile, ProjectDesign } from './designs.repo.ts';
import { readDesignGitStatus, type ScannedDesignFile, scanDesignFiles } from './designs.scanner.ts';

const CHANGED_PATHS_SAMPLE_LIMIT = 20;

function changedPaths(baseline: readonly DesignFile[], current: readonly ScannedDesignFile[]) {
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
  try {
    const root = await realpath(repoPath);
    if (!(await stat(root)).isDirectory()) return unavailable;
    await access(root, constants.R_OK | constants.X_OK);
    const status = await readDesignGitStatus(root);
    const headSha = status?.commit ?? null;
    const currentSha = headSha === null ? {} : { headSha };
    const fresh = { ...empty, ...currentSha, state: DesignStalenessState.Fresh };
    if (!design.sourceSnapshot.dirty && baseSha !== null && headSha === baseSha && status?.clean) return fresh;

    const { files: current } = await scanDesignFiles(root, design.excludePatterns);
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
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].some((code) => code === error.code)
    )
      return unavailable;
    throw error;
  }
}
