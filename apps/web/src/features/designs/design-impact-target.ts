import { type DesignDTO, decodeGitImpactTargetId, GitImpactTargetKind } from '@aw/shared';
import { fileTarget, type ReadingTarget, submodulesOf } from './design-reading.ts';

type ImpactTarget = { targetKind: GitImpactTargetKind; targetId: string };

export function resolveDesignImpactTarget(
  design: DesignDTO,
  { targetKind, targetId }: ImpactTarget,
): ReadingTarget | undefined {
  const sections = design.sections.filter(({ selected }) => selected);
  switch (targetKind) {
    case GitImpactTargetKind.Section:
      return sections.some(({ id }) => id === targetId) ? { kind: 'section', sectionId: targetId } : undefined;
    case GitImpactTargetKind.Submodule: {
      const ids = decodeGitImpactTargetId(targetId);
      if (ids === undefined) return undefined;
      const [sectionId, submoduleId] = ids;
      const section = sections.find(({ id }) => id === sectionId);
      return section !== undefined && submodulesOf(section).some(({ id }) => id === submoduleId)
        ? { kind: 'submodule', sectionId, submoduleId }
        : undefined;
    }
    case GitImpactTargetKind.Transaction: {
      const diagram = design.diagrams.find(({ id }) => id === targetId);
      return diagram !== undefined && sections.some(({ id }) => id === diagram.sectionId)
        ? { kind: 'diagram', sectionId: diagram.sectionId, diagramId: targetId }
        : undefined;
    }
    case GitImpactTargetKind.File:
    case GitImpactTargetKind.Symbol: {
      const ids = targetKind === GitImpactTargetKind.File ? [targetId] : decodeGitImpactTargetId(targetId);
      if (ids === undefined) return undefined;
      const [fileId, symbolId] = ids;
      const file = design.files.find(({ id }) => id === fileId);
      if (file?.sectionId == null || !sections.some(({ id }) => id === file.sectionId)) return undefined;
      return symbolId === undefined || file.symbols.some(({ id }) => id === symbolId)
        ? fileTarget(file, file.sectionId, symbolId)
        : undefined;
    }
  }
}
