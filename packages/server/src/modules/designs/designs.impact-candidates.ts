import { encodeGitImpactTargetId, GitImpactTargetKind } from '@aw/shared';
import type { ProjectKnowledgeIndex } from './designs.knowledge.ts';

export type ImpactTarget = {
  targetKind: GitImpactTargetKind;
  targetId: string;
  title: string;
  relPath?: string;
};

export function targetKey(target: ImpactTarget): string {
  return encodeGitImpactTargetId(target.targetKind, target.targetId);
}

export function createImpactTargets(index: ProjectKnowledgeIndex) {
  const section = (targetId: string): ImpactTarget | undefined => {
    const record = index.sections.get(targetId);
    return record && { targetKind: GitImpactTargetKind.Section, targetId, title: record.title };
  };

  const submodule = (sectionId: string, submoduleId: string): ImpactTarget | undefined => {
    const record = index.submodules.get(sectionId)?.get(submoduleId);
    return (
      record && {
        targetKind: GitImpactTargetKind.Submodule,
        targetId: encodeGitImpactTargetId(sectionId, submoduleId),
        title: record.block.title,
      }
    );
  };

  const uniqueModuleSections = new Map<string, string | null>();
  for (const [sectionId, modules] of index.submodules) {
    for (const id of modules.keys()) uniqueModuleSections.set(id, uniqueModuleSections.has(id) ? null : sectionId);
  }

  const module = (sectionId: string, id: string): ImpactTarget | undefined => {
    const local = submodule(sectionId, id) ?? section(id);
    if (local !== undefined) return local;
    const owner = uniqueModuleSections.get(id);
    return owner === undefined || owner === null ? undefined : submodule(owner, id);
  };

  const transaction = (sectionId: string, diagramId: string): ImpactTarget | undefined => {
    const record = index.transactions.get(sectionId)?.get(diagramId);
    return record && { targetKind: GitImpactTargetKind.Transaction, targetId: diagramId, title: record.block.title };
  };

  function* forPath(refs: ReturnType<ProjectKnowledgeIndex['getFileReferences']>): Generator<ImpactTarget> {
    const file = refs.file;
    if (file !== null) {
      yield {
        targetKind: GitImpactTargetKind.File,
        targetId: file.id,
        title: file.relPath,
        relPath: file.relPath,
      };
    }
    for (const id of refs.sectionIds) {
      const target = section(id);
      if (target !== undefined) yield target;
    }
    for (const { sectionId, submoduleId } of refs.submoduleRefs) {
      const target = submodule(sectionId, submoduleId);
      if (target !== undefined) yield target;
    }
    for (const { sectionId, diagramId } of refs.transactionRefs) {
      const target = transaction(sectionId, diagramId);
      if (target !== undefined) yield target;
    }
  }

  return { section, module, transaction, forPath };
}
