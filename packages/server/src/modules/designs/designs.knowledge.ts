import { posix } from 'node:path';
import {
  type DesignDiagramNode,
  type DesignEvidence,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  type DesignSubmodule,
  type DesignTransaction,
} from '@aw/shared';
import { designScope } from './designs.planning.ts';
import type {
  createDesignsRepo,
  DesignDiagramRecord,
  DesignFile,
  DesignSection,
  ProjectDesign,
} from './designs.repo.ts';

type SubmoduleRef = Readonly<{ sectionId: string; submoduleId: string }>;
type TransactionRef = Readonly<{ sectionId: string; diagramId: string }>;
type DiagramNodeRef = Readonly<{ diagramId: string; nodeId: string }>;
type FileReferences = Readonly<{
  file: Readonly<DesignFile> | null;
  sectionIds: readonly string[];
  submoduleRefs: readonly SubmoduleRef[];
  transactionRefs: readonly TransactionRef[];
  diagramNodeRefs: readonly DiagramNodeRef[];
}>;

type Section = Readonly<Pick<DesignSection, 'id' | 'kind' | 'title'> & { scopePaths: readonly string[] }>;
type Submodule = Readonly<{ sectionId: string; block: Readonly<DesignSubmodule> }>;
type Transaction = Readonly<{ sectionId: string; block: Readonly<DesignTransaction> }>;
type Diagram = Readonly<
  Pick<DesignDiagramRecord, 'id' | 'sectionId' | 'kind' | 'title'> & {
    nodes: ReadonlyMap<string, Readonly<DesignDiagramNode>>;
    edges: ReadonlyMap<string, Readonly<DesignDiagramRecord['edges'][number]>>;
    nodePaths: ReadonlyMap<string, readonly string[]>;
  }
>;

type Symbol = Readonly<DesignFile['symbols'][number]>;

export type ProjectKnowledgeIndex = Readonly<{
  designId: string;
  sourceSnapshot: Readonly<ProjectDesign['sourceSnapshot']>;
  coverage: Readonly<{ doneSections: number; totalSections: number }>;
  sections: ReadonlyMap<string, Section>;
  submodules: ReadonlyMap<string, ReadonlyMap<string, Submodule>>;
  transactions: ReadonlyMap<string, ReadonlyMap<string, Transaction>>;
  files: ReadonlyMap<string, Readonly<DesignFile>>;
  symbols: ReadonlyMap<string, ReadonlyMap<string, readonly Symbol[]>>;
  diagrams: ReadonlyMap<string, Diagram>;
  getFileReferences: (path: string) => FileReferences;
}>;

type MutableReferences = {
  sectionIds: Set<string>;
  submoduleRefs: SubmoduleRef[];
  transactionRefs: TransactionRef[];
  diagramNodeRefs: DiagramNodeRef[];
};

function collectReferences() {
  const references = new Map<string, MutableReferences>();
  return {
    get: (path: string) => references.get(path),
    add(path: string, sectionId: string) {
      const key = posix.normalize(path);
      let refs = references.get(key);
      if (refs === undefined) {
        refs = { sectionIds: new Set(), submoduleRefs: [], transactionRefs: [], diagramNodeRefs: [] };
        references.set(key, refs);
      }
      refs.sectionIds.add(sectionId);
      return refs;
    },
  };
}

type References = ReturnType<typeof collectReferences>;

function evidencePaths(evidence: readonly DesignEvidence[]): string[] {
  return evidence.flatMap((entry) => (entry.evidenceClass === DesignEvidenceClass.Static ? [entry.relPath] : []));
}

function indexSectionBlocks(sectionId: string, blocks: NonNullable<DesignSection['blocks']>, refs: References) {
  const submodules = new Map<string, Submodule>();
  const transactions = new Map<string, Transaction>();
  for (const block of blocks) {
    if (block.type === 'submodule') {
      submodules.set(block.id, { sectionId, block });
      const ref = { sectionId, submoduleId: block.id };
      const paths = new Set([...block.files, ...block.behaviors.flatMap(({ evidence }) => evidencePaths(evidence))]);
      for (const path of paths) refs.add(path, sectionId).submoduleRefs.push(ref);
    }
    if (block.type === 'transaction') {
      transactions.set(block.diagramId, { sectionId, block });
      const ref = { sectionId, diagramId: block.diagramId };
      const trace = [...(block.fields ?? []), ...(block.boundaries ?? [])];
      const paths = new Set([
        ...evidencePaths(block.evidence),
        ...trace.flatMap(({ evidence }) => evidencePaths(evidence)),
      ]);
      for (const path of paths) refs.add(path, sectionId).transactionRefs.push(ref);
    }
    if (block.type === 'code') refs.add(block.relPath, sectionId);
    if (block.type === 'markdown' && block.evidence !== undefined)
      for (const path of evidencePaths(block.evidence)) refs.add(path, sectionId);
  }
  return { submodules, transactions };
}

function indexSymbols(file: DesignFile) {
  const symbols = new Map<string, Symbol[]>();
  for (const symbol of file.symbols) {
    // 同一限定名称下保留所有重载签名。
    const group = symbols.get(symbol.qualifiedName);
    if (group === undefined) symbols.set(symbol.qualifiedName, [symbol]);
    else group.push(symbol);
  }
  return symbols;
}

function indexFiles(files: readonly DesignFile[], sections: ReadonlyMap<string, Section>, refs: References) {
  const filesByPath = new Map<string, Readonly<DesignFile>>();
  const filesById = new Map<string, Readonly<DesignFile>>();
  const symbols = new Map<string, ReadonlyMap<string, readonly Symbol[]>>();
  const symbolPaths = new Map<string, Set<string>>();
  for (const file of files) {
    const relPath = posix.normalize(file.relPath);
    const normalized = { ...file, relPath };
    filesByPath.set(relPath, normalized);
    filesById.set(file.id, normalized);
    if (file.sectionId !== null && sections.has(file.sectionId)) {
      refs.add(relPath, file.sectionId);
      if (file.symbols.length > 0) symbols.set(relPath, indexSymbols(file));
      for (const { id, qualifiedName } of file.symbols) {
        for (const key of [id, qualifiedName]) {
          const paths = symbolPaths.get(key);
          if (paths === undefined) symbolPaths.set(key, new Set([relPath]));
          else paths.add(relPath);
        }
      }
    }
  }
  return { filesByPath, filesById, symbols, symbolPaths };
}

function nodePaths(node: DesignDiagramNode, { filesByPath, filesById, symbolPaths }: ReturnType<typeof indexFiles>) {
  if (node.relPath !== undefined) return [node.relPath];
  const target = node.targetId;
  if (target === undefined) return [];
  if (node.targetKind === 'symbol') {
    const paths = symbolPaths.get(target);
    return paths?.size === 1 ? paths : [];
  }
  if (node.targetKind === 'module' || node.targetKind === 'section') return [];
  const file = filesById.get(target) ?? filesByPath.get(target);
  return file === undefined ? [] : [file.relPath];
}

function indexDiagram(
  diagram: DesignDiagramRecord,
  refs: References,
  inventory: ReturnType<typeof indexFiles>,
  transaction: Transaction | undefined,
): Diagram {
  const { id, sectionId, kind, title } = diagram;
  const paths = new Set<string>();
  const pathsByNode = new Map<string, string[]>();
  for (const node of diagram.nodes) {
    const resolved = [...nodePaths(node, inventory)].map((path) => posix.normalize(path));
    pathsByNode.set(node.id, resolved);
    for (const path of resolved) {
      refs.add(path, sectionId).diagramNodeRefs.push({ diagramId: id, nodeId: node.id });
      paths.add(path);
    }
  }
  for (const edge of diagram.edges) {
    if (edge.evidencePath === undefined) continue;
    refs.add(edge.evidencePath, sectionId);
    paths.add(edge.evidencePath);
  }
  if (transaction !== undefined) {
    for (const path of paths) {
      const matches = refs.add(path, sectionId).transactionRefs;
      if (!matches.some(({ diagramId }) => diagramId === id)) matches.push({ sectionId, diagramId: id });
    }
  }
  return {
    id,
    sectionId,
    kind,
    title,
    nodes: new Map(diagram.nodes.map((node) => [node.id, node])),
    edges: new Map(diagram.edges.map((edge) => [edge.id, edge])),
    nodePaths: pathsByNode,
  };
}

export function buildProjectKnowledgeIndex(
  design: Pick<ProjectDesign, 'id' | 'sourceSnapshot'>,
  sections: readonly DesignSection[],
  files: readonly DesignFile[],
  diagrams: readonly DesignDiagramRecord[],
): ProjectKnowledgeIndex {
  const refs = collectReferences();
  const completed = new Map<string, Section>();
  const submodules = new Map<string, ReadonlyMap<string, Submodule>>();
  const transactions = new Map<string, ReadonlyMap<string, Transaction>>();
  for (const { id, kind, title, scopePaths, blocks } of sections) {
    if (blocks === null) continue;
    completed.set(id, { id, kind, title, scopePaths });
    const indexed = indexSectionBlocks(id, blocks, refs);
    submodules.set(id, indexed.submodules);
    transactions.set(id, indexed.transactions);
  }
  const inventory = indexFiles(files, completed, refs);
  const graphs = new Map<string, Diagram>();
  for (const diagram of diagrams) {
    const { id, sectionId } = diagram;
    if (completed.has(sectionId))
      graphs.set(id, indexDiagram(diagram, refs, inventory, transactions.get(sectionId)?.get(id)));
  }
  const scopes = [...completed.values()].map((section) => ({ id: section.id, matches: designScope([section]) }));
  const selected = sections.filter(({ selected }) => selected);
  return {
    designId: design.id,
    sourceSnapshot: design.sourceSnapshot,
    coverage: { doneSections: selected.filter(({ id }) => completed.has(id)).length, totalSections: selected.length },
    sections: completed,
    submodules,
    transactions,
    files: inventory.filesByPath,
    symbols: inventory.symbols,
    diagrams: graphs,
    getFileReferences(path) {
      const key = posix.normalize(path);
      const direct = refs.get(key);
      const sectionIds = new Set(direct?.sectionIds);
      for (const scope of scopes) if (scope.matches(key)) sectionIds.add(scope.id);
      return {
        file: inventory.filesByPath.get(key) ?? null,
        sectionIds: [...sectionIds],
        submoduleRefs: direct?.submoduleRefs ?? [],
        transactionRefs: direct?.transactionRefs ?? [],
        diagramNodeRefs: direct?.diagramNodeRefs ?? [],
      };
    },
  };
}

export type KnowledgeSelection =
  | { match: typeof DesignKnowledgeMatch.Missing; knowledge: null }
  | {
      match: typeof DesignKnowledgeMatch.Exact | typeof DesignKnowledgeMatch.Reference;
      knowledge: ProjectKnowledgeIndex;
    };

type KnowledgeSource = Pick<ReturnType<typeof createDesignsRepo>, 'listSections' | 'listFiles' | 'listDiagrams'>;

export function readProjectKnowledge(repo: KnowledgeSource, design: ProjectDesign): ProjectKnowledgeIndex {
  const { id } = design;
  return buildProjectKnowledgeIndex(design, repo.listSections(id), repo.listFiles(id), repo.listDiagrams(id));
}

export function createProjectKnowledgeReader(
  repo: KnowledgeSource & Pick<ReturnType<typeof createDesignsRepo>, 'findLatestKnowledgeDesign'>,
) {
  return (projectId: string, targetSha: string | null): KnowledgeSelection => {
    const exact = targetSha === null ? undefined : repo.findLatestKnowledgeDesign(projectId, targetSha);
    if (exact !== undefined) return { match: DesignKnowledgeMatch.Exact, knowledge: readProjectKnowledge(repo, exact) };
    const design = repo.findLatestKnowledgeDesign(projectId);
    if (design === undefined) return { match: DesignKnowledgeMatch.Missing, knowledge: null };
    return { match: DesignKnowledgeMatch.Reference, knowledge: readProjectKnowledge(repo, design) };
  };
}
