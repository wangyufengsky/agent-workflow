import {
  DESIGN_IMPACT_MAX_DEPTH,
  DESIGN_IMPACT_MAX_ITEMS,
  DESIGN_IMPACT_PROMPT_MAX_BYTES,
  DESIGN_TITLE_MAX_CHARS,
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DesignReviewState,
  DesignSectionKind,
  type DesignSymbol,
  encodeGitImpactTargetId,
  GitImpactClassification,
  GitImpactTargetKind,
} from '@aw/shared';
import { expect, it } from 'vitest';
import {
  buildProjectKnowledgeIndex,
  type DesignDiagramRecord,
  type DesignFile,
  type DesignSection,
} from '../designs/index.ts';
import { renderDesignImpact, screenDesignImpact } from './git-reviews.impact.ts';

const design = {
  id: 'design',
  sourceSnapshot: {
    branch: 'main',
    commitSha: 'a'.repeat(40),
    dirty: false,
    scannedAt: 1,
    analyzableCount: 2,
    skippedCount: 0,
    skippedReasons: {},
    techStack: [],
  },
};

function section(id: string, blocks: DesignSection['blocks'], title = id): DesignSection {
  return {
    id,
    title,
    blocks,
    designId: design.id,
    seq: 1,
    selected: true,
    kind: DesignSectionKind.Module,
    scopePaths: [`${id}.ts`],
    summary: '',
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    previous: null,
    updatedAt: 1,
  };
}

function file(id: string, sectionId: string, relPath: string, symbols: DesignSymbol[] = []): DesignFile {
  return {
    id,
    designId: design.id,
    sectionId,
    relPath,
    symbols,
    responsibility: '实现',
    contentHash: 'c'.repeat(64),
    updatedAt: 1,
  };
}

function symbol(id: string, qualifiedName: string, callers: string[] = []): DesignSymbol {
  return { id, name: id, kind: 'function', qualifiedName, callers, lineStart: 1, lineEnd: 1, summary: '' };
}

function screen(index: ReturnType<typeof buildProjectKnowledgeIndex>, path: string, oldPath?: string) {
  return screenDesignImpact({ match: DesignKnowledgeMatch.Exact, knowledge: index, worktreeFresh: false }, [
    { path, oldPath },
  ]);
}

it('以重命名前的路径为种子反向跟踪流程边和调用方，忽略图上从种子出发的下游', () => {
  const oldPath = 'src/old.ts';
  const graphSection = section('entry', [
    {
      type: 'transaction',
      title: '结算',
      code: 'PAY',
      channel: 'web',
      version: '1',
      scenario: '订单付款',
      diagramId: 'flow',
      evidence: [],
    },
    {
      type: 'submodule',
      id: 'payments',
      title: '支付',
      summary: '办理结算',
      files: [],
      behaviors: [],
    },
  ]);
  const caller = section('caller', []);
  const core = section('core', []);
  const notification = section('notification', [
    { type: 'submodule', id: 'publish', title: '通知', summary: '发送结算通知', files: [], behaviors: [] },
  ]);
  const graph: DesignDiagramRecord = {
    id: 'flow',
    designId: design.id,
    sectionId: graphSection.id,
    kind: DesignDiagramKind.BusinessFlow,
    title: '结算流程',
    updatedAt: 1,
    nodes: [
      { id: 'changed', label: '旧实现', relPath: oldPath },
      { id: 'entry', label: '入口', targetKind: 'module', targetId: 'payments' },
      { id: 'downstream', label: '下游', relPath: 'src/downstream.ts' },
      { id: 'caller', label: '发起结算', targetKind: 'symbol', targetId: 'checkout.submit' },
      { id: 'publisher', label: '通知', targetKind: 'module', targetId: 'publish' },
    ],
    edges: [
      {
        id: 'incoming',
        from: 'entry',
        to: 'changed',
        kind: 'call',
        evidenceClass: DesignEvidenceClass.Inferred,
        rationale: '入口调用实现',
      },
      {
        id: 'outgoing',
        from: 'changed',
        to: 'downstream',
        kind: 'call',
        evidenceClass: DesignEvidenceClass.Inferred,
        rationale: '实现调用下游',
      },
      {
        id: 'caller-upstream',
        from: 'publisher',
        to: 'caller',
        kind: 'call',
        evidenceClass: DesignEvidenceClass.Inferred,
        rationale: '通知模块触发结算入口',
      },
    ],
  };
  const index = buildProjectKnowledgeIndex(
    design,
    [core, graphSection, caller, notification, section('pending', null)],
    [
      file('old-file', core.id, oldPath, [symbol('settle', 'core.settle', ['checkout.submit'])]),
      file('route-file', caller.id, 'routes/submit.ts', [symbol('submit', 'checkout.submit', ['core.settle'])]),
      file('downstream-file', caller.id, 'src/downstream.ts'),
    ],
    [graph],
  );

  const impact = screen(index, 'src/new.ts', oldPath);

  expect(impact).toMatchObject({ changedPaths: 2, uncoveredPaths: 1, truncated: false });
  expect([...impact.uncoveredPathSet]).toEqual(['src/new.ts']);
  expect(impact.candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ targetId: 'old-file', classification: GitImpactClassification.Direct, distance: 0 }),
      expect.objectContaining({ targetId: 'flow', classification: GitImpactClassification.Direct, distance: 0 }),
      expect.objectContaining({
        targetKind: GitImpactTargetKind.Submodule,
        targetId: encodeGitImpactTargetId('entry', 'payments'),
        distance: 1,
      }),
      expect.objectContaining({
        targetKind: GitImpactTargetKind.Symbol,
        targetId: encodeGitImpactTargetId('route-file', 'submit'),
        classification: GitImpactClassification.Indirect,
        distance: 1,
        sourcePath: oldPath,
      }),
      expect.objectContaining({
        targetKind: GitImpactTargetKind.Submodule,
        targetId: encodeGitImpactTargetId('notification', 'publish'),
        distance: 2,
        sourcePath: oldPath,
      }),
    ]),
  );
  expect(impact.candidates.filter(({ targetId }) => targetId === 'downstream-file')).toEqual([]);
});

it('仅在深度边界之后仍有未访问的调用方时截断', () => {
  const names = ['entry', 'caller1', 'caller2', 'caller3', 'caller4'];
  const files = names.map((name, index) =>
    file(name, 'main', `${name}.ts`, [
      symbol(
        name,
        `scope.${name}`,
        names.slice(index + 1, index + 2).map((next) => `scope.${next}`),
      ),
    ]),
  );
  const impact = screen(buildProjectKnowledgeIndex(design, [section('main', [])], files, []), 'entry.ts');

  expect(impact.truncated).toBe(true);
  expect(
    impact.candidates
      .filter(({ targetKind }) => targetKind === GitImpactTargetKind.Symbol)
      .map(({ title, distance }) => [title, distance]),
  ).toEqual(names.slice(0, DESIGN_IMPACT_MAX_DEPTH + 1).map((name, distance) => [`scope.${name}`, distance]));
});

it('将节点数与 UTF-8 注入体积限制在两种独立预算内', () => {
  const sections = Array.from({ length: DESIGN_IMPACT_MAX_ITEMS + 2 }, (_, i) =>
    section(`s-${i}`, [], '支'.repeat(DESIGN_TITLE_MAX_CHARS)),
  );
  const files = sections.map(({ id }) => file(`f-${id}`, id, `${id}.ts`));
  const knowledge = buildProjectKnowledgeIndex(design, sections, files, []);
  const selection = { match: DesignKnowledgeMatch.Reference, knowledge, worktreeFresh: false } as const;
  const impact = screenDesignImpact(
    selection,
    files.map(({ relPath }) => ({ path: relPath })),
  );
  expect(impact.candidates).toHaveLength(DESIGN_IMPACT_MAX_ITEMS);
  expect(impact.truncated).toBe(true);

  const byBytes = screenDesignImpact(
    selection,
    files.slice(0, 28).map(({ relPath }) => ({ path: relPath })),
  );
  expect(byBytes.truncated).toBe(false);
  const rendered = renderDesignImpact(byBytes);
  expect(rendered.truncated).toBe(true);
  expect(Buffer.byteLength(rendered.context, 'utf8')).toBeLessThanOrEqual(DESIGN_IMPACT_PROMPT_MAX_BYTES);
  expect(rendered.context).toContain('参考设计（非当前目标版本，reference）');
  expect(rendered.context).toContain('影响初筛已截断');
});

it('项目没有设计时维持源码审查', () => {
  const impact = screenDesignImpact({ match: DesignKnowledgeMatch.Missing, knowledge: null, worktreeFresh: false }, []);
  expect(impact).toMatchObject({ match: DesignKnowledgeMatch.Missing, knowledge: null, candidates: [] });
  expect(renderDesignImpact(impact)).toEqual({
    context: '未建立可用项目设计（missing）。基于目标源码和 Diff 完成审查。',
    truncated: false,
  });
});
