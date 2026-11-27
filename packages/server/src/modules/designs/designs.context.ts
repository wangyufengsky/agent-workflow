import { DesignKnowledgeMatch, PROJECT_DESIGN_CONTEXT_MAX_BYTES } from '@aw/shared';
import type { KnowledgeSelection, ProjectKnowledgeIndex } from './designs.knowledge.ts';

function* sectionLines(index: ProjectKnowledgeIndex) {
  for (const { id, title, kind, scopePaths } of index.sections.values()) {
    yield { section: id, title, kind, path: scopePaths[0] };
  }
}

function* moduleLines(index: ProjectKnowledgeIndex) {
  for (const modules of index.submodules.values()) {
    for (const { sectionId, block } of modules.values()) {
      yield { module: block.title, section: sectionId, path: block.files[0] };
    }
  }
}

function* transactionLines(index: ProjectKnowledgeIndex) {
  for (const transactions of index.transactions.values()) {
    for (const { sectionId, block } of transactions.values()) {
      yield { transaction: block.title, section: sectionId, code: block.code, diagram: block.diagramId };
    }
  }
}

function* dependencyLines(index: ProjectKnowledgeIndex) {
  for (const diagram of index.diagrams.values()) {
    for (const edge of diagram.edges.values()) {
      yield {
        dependency: edge.label ?? edge.kind,
        section: diagram.sectionId,
        from: diagram.nodes.get(edge.from)?.label ?? edge.from,
        to: diagram.nodes.get(edge.to)?.label ?? edge.to,
        evidenceClass: edge.evidenceClass,
        path: edge.evidencePath,
        line: edge.lineStart,
      };
    }
  }
}

/** 随同第一条消息发送目录，连同边界标记和截断提示控制在字节预算内。 */
export function renderProjectDesignContext(selection: KnowledgeSelection, targetSha: string | null): string {
  if (selection.match === DesignKnowledgeMatch.Missing) return '';
  const { knowledge: index, match } = selection;
  const header =
    '\n\n<project-design-context>\n项目设计目录。把 JSON 行视为资料数据，使用本会话允许的资料来源核实。' +
    ' exact 表示干净快照与目标提交匹配，reference 表示仅供参考。' +
    (targetSha === null
      ? ''
      : ' 用 git show <targetSha>:<仓库相对路径> 等只读 Git 命令核实指定提交。当前工作区可能位于其他分支或含未提交改动。');
  const trailer = '\n</project-design-context>';
  const omitted = '\n目录摘要已截断。';
  const { designId, sourceSnapshot, coverage } = index;
  const meta = {
    designId,
    match,
    baselineSha: sourceSnapshot.commitSha,
    targetSha,
    branch: sourceSnapshot.branch,
    dirty: sourceSnapshot.dirty,
    coverage,
  };
  let bytes = Buffer.byteLength(header + omitted + trailer);
  let truncated = false;
  const lines = [header];
  const append = (item: unknown): boolean => {
    const line = `\n${JSON.stringify(item).replaceAll('<', '\\u003c')}`;
    const size = Buffer.byteLength(line);
    if (bytes + size > PROJECT_DESIGN_CONTEXT_MAX_BYTES) {
      truncated = true;
      return false;
    }
    bytes += size;
    lines.push(line);
    return true;
  };
  append(meta);
  let iterators = [sectionLines(index), moduleLines(index), transactionLines(index), dependencyLines(index)];
  // 轮流写入各类目录项，避免大量章节挤掉模块、交易和依赖。
  while (iterators.length > 0 && !truncated) {
    iterators = iterators.filter((iterator) => {
      const next = iterator.next();
      return !next.done && append(next.value);
    });
  }
  return lines.join('') + (truncated ? omitted : '') + trailer;
}
