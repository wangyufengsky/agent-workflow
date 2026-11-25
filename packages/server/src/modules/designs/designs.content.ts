import { AppError, DesignReviewState, type DesignSectionVersion, ErrorCode } from '@aw/shared';
import type { createDesignsRepo, DesignDiagramRecord, DesignFile, DesignSection } from './designs.repo.ts';

type Repo = ReturnType<typeof createDesignsRepo>;

export function snapshotSection(
  section: DesignSection,
  files: readonly DesignFile[],
  diagrams: readonly DesignDiagramRecord[],
): DesignSectionVersion | null {
  if (section.blocks === null) return null;
  return {
    summary: section.summary,
    blocks: section.blocks,
    files: files.flatMap(({ relPath, responsibility, symbols, sectionId }) =>
      sectionId === section.id && responsibility !== null ? [{ relPath, responsibility, symbols }] : [],
    ),
    diagrams: diagrams.map(
      ({ designId: _designId, sectionId: _sectionId, updatedAt: _updatedAt, ...diagram }) => diagram,
    ),
  };
}

/** 在调用者的事务内同时替换正文、文件归属和图。上一版暂时保有的文件可在恢复时原位取回。 */
export function replaceSectionContent(
  repo: Repo,
  section: DesignSection,
  files: readonly DesignFile[],
  content: DesignSectionVersion,
  previous: DesignSectionVersion | null,
  now: number,
) {
  const inventory = new Map(files.map((file) => [file.relPath, file]));
  const updated = new Set<string>();
  for (const [index, entry] of content.files.entries()) {
    const file = inventory.get(entry.relPath);
    if (file === undefined || (file.sectionId !== null && file.sectionId !== section.id)) {
      const message = 'Choose a scanned file whose details do not belong to another section';
      throw new AppError(ErrorCode.ValidationFailed, message, {
        issues: [{ path: ['files', index, 'relPath'], message }],
      });
    }
    updated.add(file.id);
    repo.updateFile({ ...file, ...entry, sectionId: section.id, updatedAt: now });
  }
  const reserved = new Set(previous?.files.map((file) => file.relPath));
  for (const file of files) {
    if (file.sectionId === section.id && !updated.has(file.id))
      repo.updateFile({
        ...file,
        sectionId: reserved.has(file.relPath) ? section.id : null,
        responsibility: null,
        symbols: [],
        updatedAt: now,
      });
  }
  repo.deleteSectionDiagrams(section.designId, section.id);
  repo.insertDiagrams(
    content.diagrams.map((diagram) => ({
      ...diagram,
      designId: section.designId,
      sectionId: section.id,
      updatedAt: now,
    })),
  );
  repo.updateSection({
    ...section,
    summary: content.summary,
    blocks: content.blocks,
    previous,
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    updatedAt: now,
  });
}
