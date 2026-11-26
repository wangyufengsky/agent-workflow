import {
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignReviewState,
  DesignSectionKind,
  type DesignSubmodule,
  type DesignTransaction,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { buildProjectKnowledgeIndex } from './designs.knowledge.ts';
import type { DesignDiagramRecord, DesignFile, DesignSection } from './designs.repo.ts';

const sourceSnapshot = {
  branch: 'main',
  commitSha: 'a'.repeat(40),
  dirty: false,
  scannedAt: 1,
  analyzableCount: 2,
  skippedCount: 1,
  skippedReasons: { credentials: 1 },
  techStack: ['TypeScript'],
};

function section(id: string, scopePaths: string[], blocks: DesignSection['blocks']): DesignSection {
  return {
    id,
    designId: 'design',
    seq: 1,
    selected: true,
    kind: DesignSectionKind.Overview,
    title: id,
    scopePaths,
    summary: '',
    blocks,
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    previous: null,
    updatedAt: 1,
  };
}

it('按稳定键保留图证据、同名符号和跨章节的文件引用', () => {
  const relPath = 'src/api.ts';
  const evidence = { evidenceClass: DesignEvidenceClass.Static, relPath, lineStart: 2, lineEnd: 3 };
  const submodule: DesignSubmodule = {
    type: 'submodule',
    id: 'handler',
    title: '处理器',
    summary: '处理请求',
    files: [relPath],
    behaviors: [{ title: '读取', markdown: '读取请求', evidence: [evidence] }],
  };
  const transaction: DesignTransaction = {
    type: 'transaction',
    title: '发起付款',
    code: 'PAY',
    channel: 'web',
    version: 'v1',
    scenario: '单笔付款',
    diagramId: 'flow',
    evidence: [evidence, evidence],
  };
  const symbol = {
    id: 'start',
    name: 'start',
    kind: 'method',
    qualifiedName: 'Payments.start',
    signature: 'start(id: string)',
    lineStart: 2,
    lineEnd: 3,
    summary: '加载请求',
    callers: ['route'],
    callees: ['charge'],
  };
  const overload = { ...symbol, id: 'retry', signature: 'start(id: number)' };
  const file: DesignFile = {
    id: 'api',
    designId: 'design',
    sectionId: 'api',
    relPath,
    responsibility: '处理请求',
    symbols: [symbol, overload],
    contentHash: 'b'.repeat(64),
    updatedAt: 1,
  };
  const diagram: DesignDiagramRecord = {
    id: 'flow',
    designId: 'design',
    sectionId: 'payments',
    kind: DesignDiagramKind.BusinessFlow,
    title: '付款流转',
    nodes: [
      { id: 'entry', label: '入口', targetKind: 'file', targetId: file.id },
      { id: 'out', label: '执行', targetKind: 'symbol', targetId: symbol.qualifiedName },
    ],
    edges: [
      {
        id: 'call',
        from: 'entry',
        to: 'out',
        kind: 'call',
        evidenceClass: DesignEvidenceClass.Static,
        evidencePath: relPath,
        lineStart: 2,
        lineEnd: 3,
      },
      {
        id: 'maybe',
        from: 'entry',
        to: 'out',
        kind: 'retry',
        evidenceClass: DesignEvidenceClass.Inferred,
        rationale: '重试由配置控制',
      },
    ],
    updatedAt: 1,
  };

  const index = buildProjectKnowledgeIndex(
    { id: 'design', sourceSnapshot },
    [
      section('api', ['src'], [submodule]),
      section(
        'payments',
        ['payments'],
        [transaction, { ...transaction, diagramId: 'refund', code: 'REFUND' }, { ...submodule, id: 'reconciliation' }],
      ),
      section('unfinished', ['src'], null),
    ],
    [file],
    [diagram, { ...diagram, id: 'refund', nodes: [{ id: 'request', label: '退款请求' }], edges: [] }],
  );

  expect(index.sourceSnapshot).toEqual(sourceSnapshot);
  expect(index.coverage).toEqual({ doneSections: 2, totalSections: 3 });
  expect(index.sections.get('api')).toEqual({
    id: 'api',
    title: 'api',
    kind: DesignSectionKind.Overview,
    scopePaths: ['src'],
  });
  expect(index.sections.has('unfinished')).toBe(false);
  expect(index.submodules.get('api')?.get('handler')).toEqual({ sectionId: 'api', block: submodule });
  expect(index.transactions.get('payments')?.get('flow')).toEqual({ sectionId: 'payments', block: transaction });
  expect(index.files.get(relPath)).toEqual(file);
  expect(index.symbols.get(relPath)?.get(symbol.qualifiedName)).toEqual([symbol, overload]);
  expect(index.diagrams.get('flow')?.edges).toEqual(new Map(diagram.edges.map((edge) => [edge.id, edge])));
  expect(index.getFileReferences('./src//api.ts')).toEqual({
    file,
    sectionIds: ['api', 'payments'],
    submoduleRefs: [
      { sectionId: 'api', submoduleId: 'handler' },
      { sectionId: 'payments', submoduleId: 'reconciliation' },
    ],
    transactionRefs: [
      { sectionId: 'payments', diagramId: 'flow' },
      { sectionId: 'payments', diagramId: 'refund' },
    ],
    diagramNodeRefs: [
      { diagramId: 'flow', nodeId: 'entry' },
      { diagramId: 'flow', nodeId: 'out' },
    ],
  });
  expect(index.getFileReferences('src/new.ts')).toMatchObject({ file: null, sectionIds: ['api'] });
  expect(index.getFileReferences('src-other/new.ts').sectionIds).toEqual([]);
});
