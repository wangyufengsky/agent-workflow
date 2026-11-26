import { randomUUID } from 'node:crypto';
import type { DesignSectionVersion } from '@aw/shared';
import { DELETED_DESIGN_FILE_HASH, observeDesignChanges } from './designs.changes.ts';
import { designScope } from './designs.planning.ts';
import type { createDesignsRepo, DesignFile, DesignSection, ProjectDesign } from './designs.repo.ts';
import { scanDesignProject } from './designs.scanner.ts';

type Repo = ReturnType<typeof createDesignsRepo>;

export async function freezeDesignUpdate(
  repo: Repo,
  design: ProjectDesign,
  repoPath: string,
  now: number,
  snapshotDir?: string,
) {
  const scan = await scanDesignProject(repoPath, design.excludePatterns, now, snapshotDir);
  const baseline = repo.listFiles(design.id);
  const inventory = new Map(baseline.map((file) => [file.relPath, file]));
  // 完整更新会清除已删除文件的行，上一版仍须保有其职责归属。
  const reserved = new Map(
    repo
      .listSections(design.id)
      .flatMap(({ id, previous }) => previous?.files.map(({ relPath }) => [relPath, id] as const) ?? []),
  );
  const files = scan.files.map((item): DesignFile => {
    const { relPath, contentHash } = item;
    const existing = inventory.get(relPath);
    return existing === undefined
      ? { ...newFile(design.id, relPath, contentHash, now), sectionId: reserved.get(relPath) ?? null }
      : { ...existing, contentHash };
  });
  return {
    targetSnapshot: scan.snapshot,
    files,
    targetHashes: new Map(files.map(({ relPath, contentHash }) => [relPath, contentHash])),
    ...observeDesignChanges(repo, design, baseline, files),
  };
}

export type FrozenDesignUpdate = Awaited<ReturnType<typeof freezeDesignUpdate>>;

function newFile(designId: string, relPath: string, contentHash: string, now: number): DesignFile {
  return {
    id: randomUUID(),
    designId,
    relPath,
    contentHash,
    sectionId: null,
    responsibility: null,
    symbols: [],
    updatedAt: now,
  };
}

export function filesForDesignUpdateSection(
  section: DesignSection,
  frozen: FrozenDesignUpdate,
  currentFiles: readonly Pick<DesignFile, 'relPath' | 'sectionId'>[],
) {
  const inScope = designScope([section]);
  const current = new Map(currentFiles.map((file) => [file.relPath, file]));
  return frozen.files
    .filter(({ relPath }) => inScope(relPath) || frozen.observations.get(relPath)?.has(section.id))
    .map((file) => {
      const existing = current.get(file.relPath);
      return existing === undefined ? file : { ...file, sectionId: existing.sectionId };
    });
}

export function materializeDesignUpdateFiles(
  repo: Repo,
  designId: string,
  sectionId: string,
  frozen: FrozenDesignUpdate,
) {
  const paths = new Set(repo.fileInventory(designId).map(({ relPath }) => relPath));
  repo.insertFiles(
    frozen.files.filter(({ relPath }) => !paths.has(relPath) && frozen.observations.get(relPath)?.has(sectionId)),
  );
}

export function snapshotDesignUpdateSection(section: DesignSection, frozen: FrozenDesignUpdate) {
  return [...(frozen.affectedPaths.get(section.id) ?? [])].flatMap((path) => {
    const previous = frozen.observations.get(path)?.get(section.id);
    return previous === undefined ? [] : [previous];
  });
}

export function commitDesignUpdateSection(repo: Repo, designId: string, sectionId: string, frozen: FrozenDesignUpdate) {
  const paths = frozen.affectedPaths.get(sectionId);
  if (paths === undefined) return;
  const files = new Map(repo.listFiles(designId).map((file) => [file.relPath, file]));
  for (const section of repo.listSections(designId)) {
    const hashes = new Map(section.sourceHashes?.map((item) => [item.relPath, item]));
    let changed = false;
    for (const relPath of paths) {
      const before = frozen.observations.get(relPath)?.get(section.id);
      if (before === undefined) continue;
      if (section.id === sectionId) {
        hashes.set(relPath, { relPath, contentHash: frozen.targetHashes.get(relPath) ?? null });
      } else {
        if (hashes.has(relPath)) continue;
        hashes.set(relPath, before);
      }
      changed = true;
    }
    if (changed) repo.setSectionSourceHashes(designId, section.id, [...hashes.values()]);
  }
  for (const relPath of paths) {
    const file = files.get(relPath);
    if (file !== undefined)
      repo.updateFileHash(designId, file.id, frozen.targetHashes.get(relPath) ?? DELETED_DESIGN_FILE_HASH);
  }
}

export function commitDesignUpdateSnapshot(repo: Repo, designId: string, frozen: FrozenDesignUpdate) {
  const inventory = repo.listFiles(designId);
  const existing = new Set(inventory.map(({ relPath }) => relPath));
  const removed: string[] = [];
  for (const { id, relPath, contentHash } of inventory) {
    const hash = frozen.targetHashes.get(relPath);
    if (hash === undefined) removed.push(id);
    else if (hash !== contentHash) repo.updateFileHash(designId, id, hash);
  }
  repo.insertFiles(frozen.files.filter(({ relPath }) => !existing.has(relPath)));
  repo.deleteFiles(designId, removed);
  repo.clearSectionSourceHashes(designId);
  repo.setSourceSnapshot(designId, frozen.targetSnapshot);
}

export function restoreDesignUpdateSection(
  repo: Repo,
  section: DesignSection,
  previous: DesignSectionVersion,
  now: number,
): DesignSection {
  const available = new Set(repo.fileInventory(section.designId).map(({ relPath }) => relPath));
  repo.insertFiles(
    previous.files.flatMap(({ relPath }) =>
      available.has(relPath) ? [] : [newFile(section.designId, relPath, DELETED_DESIGN_FILE_HASH, now)],
    ),
  );
  if (previous.sourceHashes === undefined) return section;
  const hashes = new Map(section.sourceHashes?.map((item) => [item.relPath, item]));
  for (const item of previous.sourceHashes) hashes.set(item.relPath, item);
  return { ...section, sourceHashes: [...hashes.values()] };
}
