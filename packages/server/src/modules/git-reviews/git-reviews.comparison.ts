import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type DesignBlock,
  DesignKnowledgeMatch,
  type DiffFile,
  DiffFileStatus,
  type GitComparisonDTO,
  type GitComparisonItemDTO,
  GitComparisonStatus,
} from '@aw/shared';
import copy from '../../../../../apps/web/src/copy/git-review-site.json' with { type: 'json' };
import type { ProjectKnowledgeIndex, ReviewKnowledgeSelection } from '../designs/index.ts';

const { screening } = copy.comparison;

type Entity = {
  id: string;
  title: string;
  key: string;
  hints: readonly string[];
  content: unknown;
  paths: ReadonlySet<string>;
  linkPaths: ReadonlySet<string>;
  partialIdentity?: boolean;
};

type Diagram = NonNullable<ReturnType<ProjectKnowledgeIndex['diagrams']['get']>>;

type Touches = { sections: Map<string, Set<string>>; transactions: Map<string, Set<string>> };

function collectTouches(index: ProjectKnowledgeIndex, paths: readonly string[]): Touches {
  const sections = new Map<string, Set<string>>();
  const transactions = new Map<string, Set<string>>();
  function add(map: Map<string, Set<string>>, id: string, path: string) {
    const current = map.get(id);
    if (current === undefined) map.set(id, new Set([path]));
    else current.add(path);
  }

  for (const path of paths) {
    const refs = index.getFileReferences(path);
    for (const id of refs.sectionIds) add(sections, id, path);
    for (const ref of refs.transactionRefs) add(transactions, ref.diagramId, path);
  }
  return { sections, transactions };
}

function compareDiagram(diagram: Diagram) {
  const { kind, title, nodes, edges, nodePaths } = diagram;
  const nodeKeys = new Map(
    [...nodes.values()].map(({ id, label, group, targetKind, summary }) => [
      id,
      JSON.stringify([label, group, targetKind, summary, nodePaths.get(id)]),
    ]),
  );
  // 模型每次生成的节点 ID 可以不同，按显示身份和路径比对关系。
  return {
    kind,
    title,
    nodes: [...nodeKeys.values()].sort(),
    edges: [...edges.values()]
      .map(({ from, to, kind, label, evidenceClass, evidencePath, rationale }) =>
        JSON.stringify([nodeKeys.get(from), nodeKeys.get(to), kind, label, evidenceClass, evidencePath, rationale]),
      )
      .sort(),
  };
}

function compareBlock(block: DesignBlock): unknown[] {
  if (block.type === 'diagram_ref') return [];
  if (block.type === 'submodule') {
    const { id: _, ...content } = block;
    return [content];
  }
  if (block.type === 'transaction') {
    const { diagramId: _, ...content } = block;
    return [content];
  }
  return [block];
}

function comparePaths(index: ProjectKnowledgeIndex, paths: ReadonlySet<string> = new Set()) {
  return { paths, linkPaths: new Set([...paths].filter((path) => index.files.has(path))) };
}

function sectionEntities(index: ProjectKnowledgeIndex, touches: Touches): Entity[] {
  const diagrams = Map.groupBy(index.diagrams.values(), ({ sectionId }) => sectionId);
  return [...index.sections.values()].map(({ id, kind, title, scopePaths }) => {
    const scopes = [...new Set(scopePaths.map((path) => posix.normalize(path)))].sort();
    const hint = JSON.stringify([kind, title.trim()]);
    return {
      id,
      title,
      key: JSON.stringify([hint, scopes]),
      hints: scopes.length === 0 ? [hint] : [hint, JSON.stringify([kind, scopes])],
      content: {
        blocks: index.sectionBlocks.get(id)?.flatMap(compareBlock),
        diagrams: diagrams.get(id)?.map(compareDiagram),
      },
      ...comparePaths(index, touches.sections.get(id)),
    };
  });
}

function transactionEntities(index: ProjectKnowledgeIndex, touches: Touches): Entity[] {
  const entities: Entity[] = [];
  for (const blocks of index.transactions.values()) {
    for (const { block } of blocks.values()) {
      const { diagramId: id, title, code, channel, version, ...rest } = block;
      const hint = JSON.stringify([code, channel, version, code === undefined ? title : undefined]);
      const diagram = index.diagrams.get(id);
      entities.push({
        id,
        title,
        key: hint,
        hints: [],
        partialIdentity: code === undefined || channel === undefined || version === undefined,
        content: { title, ...rest, diagram: diagram === undefined ? undefined : compareDiagram(diagram) },
        ...comparePaths(index, touches.transactions.get(id)),
      });
    }
  }
  return entities;
}

function evidencePaths(from?: Entity, to?: Entity, renamed?: ReadonlyMap<string, string>) {
  const oldPaths = from?.linkPaths;
  const newPaths = to?.linkPaths;
  const [right] = newPaths ?? [];
  if (right === undefined) {
    const [left] = oldPaths ?? [];
    return left === undefined ? {} : { fromPath: left };
  }
  for (const path of oldPaths ?? []) {
    if (newPaths?.has(path)) return { fromPath: path, toPath: path };
  }
  for (const path of oldPaths ?? []) {
    const target = renamed?.get(path);
    if (target !== undefined && newPaths?.has(target)) return { fromPath: path, toPath: target };
  }
  // 同一章节内的两次单侧变更可能来自无关文件。
  return { toPath: right };
}

function diffItem(
  from: Entity | undefined,
  to: Entity | undefined,
  status: GitComparisonStatus,
  detail?: string,
  renamed?: ReadonlyMap<string, string>,
): GitComparisonItemDTO {
  return {
    status,
    title: to?.title ?? from?.title ?? '',
    ...(from === undefined ? {} : { fromId: from.id }),
    ...(to === undefined ? {} : { toId: to.id }),
    ...evidencePaths(from, to, renamed),
    ...(detail === undefined ? {} : { detail }),
  };
}

function align(
  before: Entity[],
  after: Entity[],
  renamed: ReadonlyMap<string, string>,
  coverage: { fromComplete: boolean; toComplete: boolean },
) {
  const fromKeys = Map.groupBy(before, ({ key }) => key);
  const toKeys = Map.groupBy(after, ({ key }) => key);
  const rows: GitComparisonItemDTO[] = [];
  const removed: Entity[] = [];
  const added: Entity[] = [];

  for (const key of new Set([...fromKeys.keys(), ...toKeys.keys()])) {
    const from = fromKeys.get(key) ?? [];
    const to = toKeys.get(key) ?? [];
    const [left] = from;
    const [right] = to;
    if (from.length > 1 || to.length > 1) {
      const detail = screening.duplicate;
      rows.push(
        ...from.map((entity) => diffItem(entity, undefined, GitComparisonStatus.Uncertain, detail)),
        ...to.map((entity) => diffItem(undefined, entity, GitComparisonStatus.Uncertain, detail)),
      );
    } else if (left !== undefined && right !== undefined) {
      const changed = left.paths.size > 0 || right.paths.size > 0 || !isDeepStrictEqual(left.content, right.content);
      if (left.partialIdentity || right.partialIdentity) {
        rows.push(diffItem(left, right, GitComparisonStatus.Uncertain, screening.partialIdentity, renamed));
      } else {
        rows.push(
          diffItem(
            left,
            right,
            changed ? GitComparisonStatus.Modified : GitComparisonStatus.Unchanged,
            undefined,
            renamed,
          ),
        );
      }
    } else if (left !== undefined) removed.push(left);
    else if (right !== undefined) added.push(right);
  }

  rows.push(...alignPossibleRenames(removed, added, renamed, coverage));
  return rows;
}

function alignPossibleRenames(
  removed: readonly Entity[],
  added: readonly Entity[],
  renamed: ReadonlyMap<string, string>,
  coverage: { fromComplete: boolean; toComplete: boolean },
) {
  const candidatesByHint = new Map<string, Entity[]>();
  for (const entity of added) {
    for (const hint of [...entity.hints, ...[...entity.paths].map((path) => JSON.stringify(path))]) {
      const candidates = candidatesByHint.get(hint);
      if (candidates === undefined) candidatesByHint.set(hint, [entity]);
      else candidates.push(entity);
    }
  }

  const matches = new Map<Entity, Set<Entity>>();
  const incoming = new Map<Entity, number>();
  for (const entity of removed) {
    const targets = [...entity.paths].flatMap((path) => {
      const nextPath = renamed.get(path);
      return nextPath === undefined ? [] : [JSON.stringify(nextPath)];
    });
    const candidates = new Set([...entity.hints, ...targets].flatMap((key) => candidatesByHint.get(key) ?? []));
    matches.set(entity, candidates);
    for (const candidate of candidates) incoming.set(candidate, (incoming.get(candidate) ?? 0) + 1);
  }

  const renamedTargets = new Set(renamed.values());
  const paired = new Set<Entity>();
  const rows: GitComparisonItemDTO[] = [];
  for (const from of removed) {
    const candidates = matches.get(from);
    const [to] = candidates ?? [];
    if (candidates?.size === 1 && to !== undefined && incoming.get(to) === 1) {
      paired.add(to);
      rows.push(diffItem(from, to, GitComparisonStatus.Uncertain, screening.possibleRename, renamed));
    } else {
      const possibleRename = (candidates?.size ?? 0) > 0 || [...from.paths].some((path) => renamed.has(path));
      rows.push(unmatched(from, undefined, possibleRename, coverage.toComplete));
    }
  }

  for (const to of added) {
    if (paired.has(to)) continue;
    const possibleRename = incoming.has(to) || [...to.paths].some((path) => renamedTargets.has(path));
    rows.push(unmatched(undefined, to, possibleRename, coverage.fromComplete));
  }
  return rows;
}

function unmatched(
  from: Entity | undefined,
  to: Entity | undefined,
  possibleRename: boolean,
  oppositeComplete: boolean,
) {
  if (possibleRename) return diffItem(from, to, GitComparisonStatus.Uncertain, screening.possibleRename);
  if (from?.partialIdentity || to?.partialIdentity)
    return diffItem(from, to, GitComparisonStatus.Uncertain, screening.partialIdentity);
  if (!oppositeComplete) return diffItem(from, to, GitComparisonStatus.Uncertain, screening.coverageGap);
  return diffItem(from, to, from === undefined ? GitComparisonStatus.Added : GitComparisonStatus.Removed);
}

export function buildGitComparison(
  fromSelection: ReviewKnowledgeSelection,
  toSelection: ReviewKnowledgeSelection,
  files: readonly Pick<DiffFile, 'path' | 'oldPath' | 'status'>[],
): GitComparisonDTO {
  const from = fromSelection.knowledge;
  const to = toSelection.knowledge;
  const result = {
    fromMatch: fromSelection.match,
    toMatch: toSelection.match,
    ...(from === null ? {} : { fromDesignId: from.designId }),
    ...(to === null ? {} : { toDesignId: to.designId }),
  };
  if (fromSelection.match !== DesignKnowledgeMatch.Exact || toSelection.match !== DesignKnowledgeMatch.Exact) {
    return { ...result, sections: [], transactions: [], summary: screening.sourceOnlySummary };
  }

  const fromPaths: string[] = [];
  const toPaths: string[] = [];
  const renamed = new Map<string, string>();
  for (const { status, path, oldPath } of files) {
    if (status !== DiffFileStatus.Added) fromPaths.push(posix.normalize(oldPath ?? path));
    if (status !== DiffFileStatus.Deleted) toPaths.push(posix.normalize(path));
    if (status === DiffFileStatus.Renamed && oldPath !== undefined)
      renamed.set(posix.normalize(oldPath), posix.normalize(path));
  }

  const fromIndex = fromSelection.knowledge;
  const toIndex = toSelection.knowledge;
  const fromTouches = collectTouches(fromIndex, fromPaths);
  const toTouches = collectTouches(toIndex, toPaths);
  const coverage = {
    fromComplete: fromIndex.coverage.doneSections === fromIndex.coverage.totalSections,
    toComplete: toIndex.coverage.doneSections === toIndex.coverage.totalSections,
  };
  return {
    ...result,
    sections: align(sectionEntities(fromIndex, fromTouches), sectionEntities(toIndex, toTouches), renamed, coverage),
    transactions: align(
      transactionEntities(fromIndex, fromTouches),
      transactionEntities(toIndex, toTouches),
      renamed,
      coverage,
    ),
    summary: screening.initialSummary,
  };
}

export { renderGitComparison } from './git-reviews.comparison-prompt.ts';
export { mergeGitComparison } from './git-reviews.comparison-submission.ts';
