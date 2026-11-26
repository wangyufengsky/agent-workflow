import { DesignFileChangeKind, type DesignSourceHashes, type DesignStalenessDTO } from '@aw/shared';
import { buildProjectKnowledgeIndex } from './designs.knowledge.ts';
import { designScope } from './designs.planning.ts';
import type { createDesignsRepo, DesignFile, ProjectDesign } from './designs.repo.ts';
import type { ScannedDesignFile } from './designs.scanner.ts';

// 部分提交后保留已删除文件的记录，供章节上一版和其他章节继续引用。
export const DELETED_DESIGN_FILE_HASH = '';

type Repo = ReturnType<typeof createDesignsRepo>;
type Change = NonNullable<DesignStalenessDTO['changedFilesSample']>[number];
type Observation = DesignSourceHashes[number];

const inventoryHash = (contentHash: string | undefined) =>
  contentHash === undefined || contentHash === DELETED_DESIGN_FILE_HASH ? null : contentHash;

export function observeDesignChanges(
  repo: Repo,
  design: ProjectDesign,
  files: readonly DesignFile[],
  target: readonly ScannedDesignFile[],
) {
  const sections = repo.listSections(design.id).filter(({ selected }) => selected);
  let knowledge: ReturnType<typeof buildProjectKnowledgeIndex> | undefined;
  const inventory = new Map(files.map(({ relPath, contentHash }) => [relPath, contentHash]));
  const owners = new Map(files.map(({ relPath, sectionId }) => [relPath, sectionId]));
  const current = new Map(target.map(({ relPath, contentHash }) => [relPath, contentHash]));
  const scopes = sections.map((section) => ({
    id: section.id,
    includesPath: designScope([section]),
    hashes: new Map(section.sourceHashes?.map(({ relPath, contentHash }) => [relPath, contentHash])),
  }));
  const overrides = new Set(scopes.flatMap(({ hashes }) => [...hashes.keys()]));
  const paths = new Set([...inventory.keys(), ...current.keys(), ...overrides]);
  const changes: Change[] = [];
  const affected = new Set<string>();
  const observations = new Map<string, Map<string, Observation>>();
  const affectedPaths = new Map<string, Set<string>>();

  for (const relPath of paths) {
    const baseline = inventoryHash(inventory.get(relPath));
    const contentHash = current.get(relPath) ?? null;
    if (baseline === contentHash && !overrides.has(relPath)) continue;
    knowledge ??= buildProjectKnowledgeIndex(design, sections, files, repo.listDiagrams(design.id));
    const refs = new Set(knowledge.getFileReferences(relPath).sectionIds);
    const before = new Map<string, Observation>();
    let differs = false;
    let wasPresent = false;
    for (const { id, includesPath, hashes } of scopes) {
      if (!hashes.has(relPath) && !includesPath(relPath) && owners.get(relPath) !== id && !refs.has(id)) continue;
      const override = hashes.get(relPath);
      const priorHash = override === undefined ? baseline : override;
      before.set(id, { relPath, contentHash: priorHash });
      if (priorHash === contentHash) continue;
      if (priorHash !== null) wasPresent = true;
      differs = true;
      affected.add(id);
      let sectionPaths = affectedPaths.get(id);
      if (sectionPaths === undefined) {
        sectionPaths = new Set();
        affectedPaths.set(id, sectionPaths);
      }
      sectionPaths.add(relPath);
    }
    // 文件没有任何章节覆盖时，仍报告库存变动。
    if (!differs && (before.size !== 0 || baseline === contentHash)) continue;
    observations.set(relPath, before);
    changes.push({
      relPath,
      kind:
        contentHash === null
          ? DesignFileChangeKind.Removed
          : wasPresent || (before.size === 0 && baseline !== null)
            ? DesignFileChangeKind.Modified
            : DesignFileChangeKind.Added,
    });
  }

  return {
    changes: changes.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en')),
    affectedSectionIds: sections.filter(({ id }) => affected.has(id)).map(({ id }) => id),
    observations,
    affectedPaths,
  };
}
