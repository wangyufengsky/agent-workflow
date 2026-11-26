import type { DesignTransaction } from '../contracts/design/block.ts';
import type { DesignDiagramEdge, DesignDiagramNode } from '../contracts/design/diagram.ts';
import type { DesignSymbol } from '../contracts/design/file.ts';
import { layoutDesignDiagram } from './layout.ts';

type SourceFile = {
  id: string;
  relPath: string;
  symbols: readonly Pick<DesignSymbol, 'id' | 'qualifiedName' | 'name'>[];
};
export type TransactionNodeRole = 'step' | 'exception' | 'external';
export type TransactionEdgeRole = 'normal' | 'exception';

const EXCEPTION_KINDS = new Set(['throw', 'reject', 'error', 'exception', 'failure', '异常', '拒绝']);
const EXCEPTION_GROUPS = new Set(['异常出口', '异常', 'exception', 'error']);
const EXTERNAL_GROUPS = new Set(['外部边界', '外部系统边界', '外部系统', 'external', 'external boundary']);

function nodeRole(group: string | undefined): TransactionNodeRole {
  if (!group) return 'step';
  const key = group.trim().toLowerCase();
  if (EXTERNAL_GROUPS.has(key)) return 'external';
  return EXCEPTION_GROUPS.has(key) ? 'exception' : 'step';
}

function titles(node: DesignDiagramNode, symbol: string | undefined, path: string | undefined) {
  const label = node.label.trim();
  const summary = node.summary?.trim();
  // 历史图允许以实际调用或赋值表达式作标题，优先把它保留在第二行。
  if (summary && (symbol === label || /^[\w$.]+\s*[=(]/u.test(label))) {
    const title = summary.match(/^[^。；\n]+/u)?.[0];
    if (title && title !== label) return { title, detail: label };
  }
  if (symbol && label.startsWith(`${symbol} `)) return { title: label.slice(symbol.length).trim(), detail: symbol };
  const code = summary?.match(/`([^`\n]+)`/u)?.[1];
  const detail = code ?? symbol ?? path ?? node.group ?? '';
  return { title: label, detail: detail === label ? '' : detail };
}

function nodeSource(
  node: DesignDiagramNode,
  files: readonly SourceFile[],
): { file?: SourceFile; symbol?: SourceFile['symbols'][number] } {
  const file =
    node.relPath !== undefined
      ? files.find(({ relPath }) => relPath === node.relPath)
      : node.targetKind === 'file'
        ? files.find(({ id, relPath }) => node.targetId === id || node.targetId === relPath)
        : undefined;
  if (node.targetKind === 'symbol' && node.targetId !== undefined) {
    const scope = node.relPath === undefined ? files : file ? [file] : [];
    const matches = scope.flatMap((candidate) =>
      candidate.symbols
        .filter(({ id, qualifiedName }) => id === node.targetId || qualifiedName === node.targetId)
        .map((symbol) => ({ file: candidate, symbol })),
    );
    const [first, second] = matches;
    if (first && !second) return first;
  }
  return file ? { file } : {};
}

/** 交易阅读器只呈现报告已给出的动作、证据和分组，两端复用相同的排版输入。 */
export function presentTransactionDiagram(
  nodes: readonly DesignDiagramNode[],
  edges: readonly DesignDiagramEdge[],
  files: readonly SourceFile[],
  transaction: DesignTransaction,
) {
  const sourcePaths = new Set<string>();
  function includeEvidence(evidence: DesignTransaction['evidence']) {
    for (const entry of evidence) if (entry.evidenceClass === 'static') sourcePaths.add(entry.relPath);
  }
  includeEvidence(transaction.evidence);
  const displayNodes = nodes.map((node) => {
    const { file, symbol } = nodeSource(node, files);
    const path = node.relPath ?? file?.relPath;
    if (path) sourcePaths.add(path);
    const source = file ? { fileId: file.id, path: file.relPath, ...(symbol && { symbolId: symbol.id }) } : null;
    return { id: node.id, ...titles(node, symbol?.name, path), role: nodeRole(node.group), source };
  });
  const displayEdges = edges.map((edge) => {
    if (edge.evidencePath !== undefined) sourcePaths.add(edge.evidencePath);
    const role: TransactionEdgeRole = EXCEPTION_KINDS.has(edge.kind.trim().toLowerCase()) ? 'exception' : 'normal';
    return { id: edge.id, role };
  });
  for (const trace of [...(transaction.fields ?? []), ...(transaction.boundaries ?? [])])
    includeEvidence(trace.evidence);
  const boxes = displayNodes.map(({ id, title, detail }) => {
    const width = Math.max(labelUnits(title) * 8 + 54, labelUnits(detail) * 7 + 28);
    return { id, width: Math.min(264, Math.max(194, width)), height: 74 };
  });
  return {
    nodes: displayNodes,
    edges: displayEdges,
    sourcePaths: [...sourcePaths],
    layout: layoutDesignDiagram(boxes, edges, 'adaptive'),
  };
}

function labelUnits(value: string): number {
  return Array.from(value).reduce((width, char) => width + (/^[\u0020-\u007e]$/u.test(char) ? 1 : 2), 0);
}
