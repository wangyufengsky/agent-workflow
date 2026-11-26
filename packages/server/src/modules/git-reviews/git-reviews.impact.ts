import { posix } from 'node:path';
import {
  DESIGN_IMPACT_MAX_DEPTH,
  DESIGN_IMPACT_MAX_ITEMS,
  DESIGN_IMPACT_PROMPT_MAX_BYTES,
  DesignKnowledgeMatch,
  type DiffFile,
  GitImpactClassification,
} from '@aw/shared';
import type { ReviewKnowledgeSelection } from '../designs/index.ts';
import { createImpactTargets, type ImpactTarget, targetKey } from './git-reviews.impact-candidates.ts';
import { createImpactGraph, type ImpactGraphNode } from './git-reviews.impact-graph.ts';

type Candidate = ImpactTarget & {
  classification: typeof GitImpactClassification.Direct | typeof GitImpactClassification.Indirect;
  distance: number;
  sourcePath: string;
};

function screenCandidates(index: NonNullable<ReviewKnowledgeSelection['knowledge']>, paths: Set<string>) {
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
      : screenCandidates(selection.knowledge, paths);
  return {
    ...selection,
    ...result,
    changedPaths: paths.size,
    uncoveredPaths: result.uncoveredPathSet.size,
  };
}

export function renderDesignImpact(impact: ReturnType<typeof screenDesignImpact>) {
  if (impact.match === DesignKnowledgeMatch.Missing) {
    return { context: '未建立可用项目设计（missing）。基于目标源码和 Diff 完成审查。', truncated: false };
  }

  const { designId, sourceSnapshot, coverage } = impact.knowledge;
  const matchLabel =
    impact.match === DesignKnowledgeMatch.Exact ? '精确匹配设计（exact）' : '参考设计（非当前目标版本，reference）';
  const baseline = `设计 ${JSON.stringify(designId)}，基线提交 ${JSON.stringify(sourceSnapshot.commitSha)}，快照生成时工作区${sourceSnapshot.dirty ? '有变更' : '干净'}。`;
  const details = [
    ...(impact.worktreeFresh ? ['设计扫描范围内的工作区文件与快照一致。'] : []),
    `设计覆盖 ${coverage.doneSections}/${coverage.totalSections} 章，${impact.uncoveredPaths}/${impact.changedPaths} 个变更路径未映射到已完成章节（含重命名前的路径）。`,
    '以下 JSON 行仅为候选数据。direct / indirect 表示初筛来源，distance 表示反向关系边数，sourcePath 表示该次扩散起点。',
  ];
  const truncatedNotice = '\n影响初筛已截断，仍需核查未列出的变更。';
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
  const header = [matchLabel, baseline, ...details].join('\n');
  let remaining = DESIGN_IMPACT_PROMPT_MAX_BYTES - bytes(header) - bytes(truncatedNotice);
  if (remaining < 0) {
    return { context: [matchLabel, ...details].join('\n') + truncatedNotice, truncated: true };
  }
  let truncated = impact.truncated;
  const lines: string[] = [];
  for (const candidate of impact.candidates) {
    const line = `\n${JSON.stringify(candidate)}`;
    const size = bytes(line);
    if (size > remaining) {
      truncated = true;
      continue;
    }
    remaining -= size;
    lines.push(line);
  }
  return { context: header + (truncated ? truncatedNotice : '') + lines.join(''), truncated };
}
