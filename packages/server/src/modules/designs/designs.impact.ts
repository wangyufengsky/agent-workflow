import { posix } from 'node:path';
import { DESIGN_IMPACT_MAX_DEPTH, DESIGN_IMPACT_MAX_ITEMS, type DiffFile, GitImpactClassification } from '@aw/shared';
import { createImpactTargets, type ImpactTarget, targetKey } from './designs.impact-candidates.ts';
import { createImpactGraph, type ImpactGraphNode } from './designs.impact-graph.ts';
import type { ProjectKnowledgeIndex } from './designs.knowledge.ts';
import type { ReviewKnowledgeSelection } from './designs.review-knowledge.ts';

type Candidate = ImpactTarget & {
  classification: typeof GitImpactClassification.Direct | typeof GitImpactClassification.Indirect;
  distance: number;
  sourcePath: string;
};

function screenImpactPaths(index: ProjectKnowledgeIndex, paths: ReadonlySet<string>) {
  const targets = createImpactTargets(index);
  const graph = createImpactGraph(index, targets);
  const seen = new Set<string>();
  const candidates = new Map<string, Candidate>();
  const queue: Array<{ node: ImpactGraphNode; distance: number; sourcePath: string }> = [];
  let truncated = false;
  const uncoveredPathSet = new Set<string>();

  function reserve(key: string) {
    if (seen.has(key)) return true;
    if (seen.size === DESIGN_IMPACT_MAX_ITEMS) {
      truncated = true;
      return false;
    }
    seen.add(key);
    return true;
  }

  function add(target: ImpactTarget, distance: number, sourcePath: string) {
    const key = targetKey(target);
    if (candidates.has(key) || !reserve(key)) return;
    const classification = distance === 0 ? GitImpactClassification.Direct : GitImpactClassification.Indirect;
    candidates.set(key, { ...target, classification, distance, sourcePath });
  }

  // 全部直接候选先于扩散入列，宽图不能挤掉已知的直接命中。
  for (const path of paths) {
    const refs = index.getFileReferences(path);
    if (refs.sectionIds.length === 0) uncoveredPathSet.add(path);
    for (const target of targets.forPath(refs)) add(target, 0, path);
  }

  const traversed = new Set<string>();
  function enqueue(node: ImpactGraphNode, distance: number, sourcePath: string): boolean {
    if (traversed.has(node.key)) return true;
    if (distance > DESIGN_IMPACT_MAX_DEPTH) {
      truncated = true;
      return false;
    }
    if (!reserve(node.key)) return false;
    traversed.add(node.key);
    queue.push({ node, distance, sourcePath });
    return true;
  }

  for (const { node, sourcePath } of graph.roots(paths, candidates)) {
    if (!enqueue(node, 0, sourcePath)) break;
  }
  for (const { node, distance, sourcePath } of queue) {
    for (const target of graph.candidates(node)) add(target, distance, sourcePath);
    for (const upstream of graph.upstream(node)) {
      if (!enqueue(upstream, distance + 1, sourcePath)) break;
    }
  }
  return { candidates: [...candidates.values()], uncoveredPathSet, truncated };
}

export function screenDesignImpact(
  selection: ReviewKnowledgeSelection,
  files: readonly Pick<DiffFile, 'path' | 'oldPath'>[],
) {
  const paths = new Set<string>();
  for (const { path, oldPath } of files) {
    paths.add(posix.normalize(path));
    if (oldPath !== undefined) paths.add(posix.normalize(oldPath));
  }
  const result =
    selection.knowledge === null
      ? { candidates: [], uncoveredPathSet: new Set<string>(), truncated: false }
      : screenImpactPaths(selection.knowledge, paths);
  return {
    ...selection,
    ...result,
    changedPaths: paths.size,
    uncoveredPaths: result.uncoveredPathSet.size,
  };
}
