import { type DesignSymbol, encodeGitImpactTargetId, GitImpactTargetKind } from '@aw/shared';
import { type createImpactTargets, type ImpactTarget, targetKey } from './designs.impact-candidates.ts';
import type { ProjectKnowledgeIndex } from './designs.knowledge.ts';

type Diagram = NonNullable<ReturnType<ProjectKnowledgeIndex['diagrams']['get']>>;
type SymbolNode = { kind: 'symbol'; key: string; target: ImpactTarget & { relPath: string }; symbol: DesignSymbol };
type DiagramNode = { kind: 'diagram'; key: string; diagram: Diagram; id: string };
export type ImpactGraphNode = SymbolNode | DiagramNode;

function symbolTargets(index: ProjectKnowledgeIndex) {
  const byPath = new Map<string, SymbolNode[]>();
  const byIdentity = new Map<string, Set<SymbolNode>>();
  const byName = new Map<string, Set<SymbolNode>>();
  function add(map: Map<string, Set<SymbolNode>>, key: string, node: SymbolNode) {
    const entries = map.get(key);
    if (entries === undefined) map.set(key, new Set([node]));
    else entries.add(node);
  }
  for (const [path, symbols] of index.symbols) {
    const file = index.files.get(path);
    if (file === undefined) continue;
    const nodes: SymbolNode[] = [];
    for (const group of symbols.values()) {
      for (const symbol of group) {
        const target = {
          targetKind: GitImpactTargetKind.Symbol,
          targetId: encodeGitImpactTargetId(file.id, symbol.id),
          title: symbol.qualifiedName,
          relPath: path,
        };
        const node: SymbolNode = { kind: 'symbol', key: targetKey(target), target, symbol };
        nodes.push(node);
        add(byIdentity, symbol.id, node);
        add(byIdentity, symbol.qualifiedName, node);
        add(byName, symbol.name, node);
      }
    }
    byPath.set(path, nodes);
  }
  return { byPath, byIdentity, byName };
}

export function createImpactGraph(index: ProjectKnowledgeIndex, targets: ReturnType<typeof createImpactTargets>) {
  const symbols = symbolTargets(index);
  const incoming = new Map<string, Map<string, Set<string>>>();
  const symbolDiagrams = new Map<string, DiagramNode[]>();

  function diagramNode(diagram: Diagram, id: string): DiagramNode {
    return {
      kind: 'diagram',
      key: encodeGitImpactTargetId('diagram', encodeGitImpactTargetId(diagram.id, id)),
      diagram,
      id,
    };
  }

  function diagramTarget(node: NonNullable<ReturnType<Diagram['nodes']['get']>>, sectionId: string) {
    if (node.targetId === undefined) return undefined;
    if (node.targetKind === 'section') return targets.section(node.targetId);
    if (node.targetKind === 'module') return targets.module(sectionId, node.targetId);
    return undefined;
  }

  function* selectSymbols(matches: ReadonlySet<SymbolNode> | undefined, path?: string): Generator<SymbolNode> {
    if (matches === undefined) return;
    const candidates = [...matches].filter(({ target }) => path === undefined || target.relPath === path);
    const [first] = candidates;
    // 同一文件中的重载共享限定名，可一并保留；对跨文件或同名异义不猜测调用关系。
    if (
      first !== undefined &&
      candidates.every(
        ({ target, symbol }) =>
          target.relPath === first.target.relPath && symbol.qualifiedName === first.symbol.qualifiedName,
      )
    )
      yield* candidates;
  }

  function* diagramSymbols(diagram: Diagram, id: string): Generator<SymbolNode> {
    const item = diagram.nodes.get(id);
    if (item?.targetKind !== 'symbol' || item.targetId === undefined) return;
    const paths = diagram.nodePaths.get(id);
    const path = paths?.[0];
    if (path !== undefined) yield* selectSymbols(symbols.byIdentity.get(item.targetId), path);
  }

  function* roots(
    paths: ReadonlySet<string>,
    directTargets: ReadonlyMap<string, { sourcePath: string }>,
  ): Generator<{ node: ImpactGraphNode; sourcePath: string }> {
    for (const path of paths) {
      for (const node of symbols.byPath.get(path) ?? []) yield { node, sourcePath: path };
    }
    for (const diagram of index.diagrams.values()) {
      for (const node of diagram.nodes.values()) {
        const entry = diagramNode(diagram, node.id);
        for (const symbol of diagramSymbols(diagram, node.id)) {
          const bindings = symbolDiagrams.get(symbol.key);
          if (bindings === undefined) symbolDiagrams.set(symbol.key, [entry]);
          else bindings.push(entry);
        }
        const target = diagramTarget(node, diagram.sectionId);
        const direct = target === undefined ? undefined : directTargets.get(targetKey(target));
        const sourcePath = diagram.nodePaths.get(node.id)?.find((path) => paths.has(path)) ?? direct?.sourcePath;
        if (sourcePath !== undefined) yield { node: entry, sourcePath };
      }
    }
  }

  function* candidates(node: ImpactGraphNode): Generator<ImpactTarget> {
    if (node.kind === 'symbol') {
      yield node.target;
      yield* targets.forPath(index.getFileReferences(node.target.relPath));
      return;
    }
    const { diagram, id } = node;
    for (const symbol of diagramSymbols(diagram, id)) yield symbol.target;
    for (const path of diagram.nodePaths.get(id) ?? []) yield* targets.forPath(index.getFileReferences(path));
    const item = diagram.nodes.get(id);
    if (item !== undefined) {
      const target = diagramTarget(item, diagram.sectionId);
      if (target !== undefined) yield target;
    }
    const transaction = targets.transaction(diagram.sectionId, diagram.id);
    if (transaction !== undefined) yield transaction;
  }

  function* callers(node: SymbolNode): Generator<SymbolNode> {
    for (const caller of node.symbol.callers ?? []) {
      yield* selectSymbols(symbols.byIdentity.get(caller) ?? symbols.byName.get(caller));
    }
  }

  function* predecessors(node: DiagramNode): Generator<DiagramNode> {
    const { diagram, id } = node;
    let edges = incoming.get(diagram.id);
    if (edges === undefined) {
      edges = new Map();
      for (const { from, to } of diagram.edges.values()) {
        const sources = edges.get(to);
        if (sources === undefined) edges.set(to, new Set([from]));
        else sources.add(from);
      }
      incoming.set(diagram.id, edges);
    }
    for (const from of edges.get(id) ?? []) yield diagramNode(diagram, from);
  }

  function* upstream(node: ImpactGraphNode): Generator<ImpactGraphNode> {
    if (node.kind === 'symbol') {
      yield* callers(node);
      for (const binding of symbolDiagrams.get(node.key) ?? []) yield* predecessors(binding);
      return;
    }
    yield* predecessors(node);
    for (const symbol of diagramSymbols(node.diagram, node.id)) yield* callers(symbol);
  }

  return { roots, candidates, upstream };
}
