import {
  DESIGN_IMPACT_PROMPT_MAX_BYTES,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DesignReviewState,
  DesignSectionKind,
  type DesignTransaction,
  DiffFileStatus,
  ErrorCode,
  type GitComparisonItemDTO,
  GitComparisonStatus,
  gitComparisonItemSchema,
} from '@aw/shared';
import { assert, expect, it } from 'vitest';
import { buildProjectKnowledgeIndex, type ReviewKnowledgeSelection } from '../designs/index.ts';
import { buildGitComparison, mergeGitComparison, renderGitComparison } from './git-reviews.comparison.ts';

type Section = Parameters<typeof buildProjectKnowledgeIndex>[1][number];

function section(id: string, title: string, path: string, blocks: Section['blocks'] = []): Section {
  return {
    id,
    designId: 'design',
    seq: 1,
    selected: true,
    kind: DesignSectionKind.Overview,
    title,
    scopePaths: [path],
    summary: '',
    blocks,
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    previous: null,
    updatedAt: 1,
  };
}

function transaction(diagramId: string, channel: string, version: string, scenario: string): DesignTransaction {
  return {
    type: 'transaction',
    title: '支付',
    code: 'PAY',
    channel,
    version,
    scenario,
    diagramId,
    evidence: [{ evidenceClass: DesignEvidenceClass.Inferred, rationale: '调用支付处理器' }],
  };
}

function selection(
  id: string,
  sections: Section[],
  match: 'exact' | 'reference' = DesignKnowledgeMatch.Exact,
  inventory: readonly string[] = [],
) {
  return {
    match,
    worktreeFresh: false,
    knowledge: buildProjectKnowledgeIndex(
      {
        id,
        sourceSnapshot: {
          branch: 'main',
          commitSha: id.repeat(40).slice(0, 40),
          dirty: false,
          scannedAt: 1,
          analyzableCount: 10,
          skippedCount: 0,
          skippedReasons: {},
          techStack: [],
        },
      },
      sections,
      inventory.map((relPath) => ({
        id: relPath,
        designId: id,
        sectionId: null,
        relPath,
        responsibility: '',
        symbols: [],
        contentHash: 'a'.repeat(64),
        updatedAt: 1,
      })),
      [],
    ),
  } satisfies ReviewKnowledgeSelection;
}

const missing = { match: DesignKnowledgeMatch.Missing, knowledge: null, worktreeFresh: false } as const;

it('按章节范围和交易码、渠道、版本跨快照对齐生成时不同的 ID', () => {
  const before = selection('old', [
    section('old-pay', '支付', 'pay', [
      transaction('old-web', 'web', 'v1', '单笔'),
      transaction('old-app', 'app', 'v1', '单笔'),
    ]),
    section('old-docs', '文档', 'docs'),
    section('old-inventory', '库存', 'inventory'),
  ]);
  const after = selection('new', [
    section('new-pay', '支付', './pay', [
      transaction('new-web', 'web', 'v1', '批量'),
      transaction('new-app', 'app', 'v2', '单笔'),
    ]),
    section('new-docs', '文档', 'docs'),
    section('new-audit', '审计', 'audit'),
  ]);
  const comparison = buildGitComparison(before, after, []);

  expect(comparison.sections).toEqual([
    { status: GitComparisonStatus.Modified, title: '支付', fromId: 'old-pay', toId: 'new-pay' },
    { status: GitComparisonStatus.Unchanged, title: '文档', fromId: 'old-docs', toId: 'new-docs' },
    { status: GitComparisonStatus.Removed, title: '库存', fromId: 'old-inventory' },
    { status: GitComparisonStatus.Added, title: '审计', toId: 'new-audit' },
  ]);
  expect(comparison.transactions).toEqual([
    { status: GitComparisonStatus.Modified, title: '支付', fromId: 'old-web', toId: 'new-web' },
    { status: GitComparisonStatus.Removed, title: '支付', fromId: 'old-app' },
    { status: GitComparisonStatus.Added, title: '支付', toId: 'new-app' },
  ]);
});

it('以 Git 改名连接唯一候选并保留两端各自路径，覆盖有缺口的条目同样待确认', () => {
  const before = selection(
    'old',
    [section('old', '旧入口', 'legacy'), section('orphan', '另一个模块', 'untouched')],
    DesignKnowledgeMatch.Exact,
    ['legacy/entry.ts'],
  );
  const after = selection(
    'new',
    [section('new', '新入口', 'src'), section('pending', '未生成', 'untouched', null)],
    DesignKnowledgeMatch.Exact,
    ['src/entry.ts'],
  );
  const comparison = buildGitComparison(before, after, [
    { status: DiffFileStatus.Renamed, oldPath: 'legacy/excluded.ts', path: 'src/excluded.ts' },
    { status: DiffFileStatus.Renamed, oldPath: 'legacy/entry.ts', path: 'src/entry.ts' },
  ]);
  expect(comparison.sections).toEqual([
    {
      status: GitComparisonStatus.Uncertain,
      title: '新入口',
      fromId: 'old',
      toId: 'new',
      fromPath: 'legacy/entry.ts',
      toPath: 'src/entry.ts',
      detail: '可能存在改名或范围调整，需核实 Git 两端源码。',
    },
    {
      status: GitComparisonStatus.Uncertain,
      title: '另一个模块',
      fromId: 'orphan',
      detail: '另一端设计覆盖不完整，需核实 Git 两端源码。',
    },
  ]);
  const confirmed = {
    ...comparison,
    sections: comparison.sections.slice(0, 1).map((row) => ({
      ...row,
      status: GitComparisonStatus.Modified,
      detail: '同一入口移动到 src。',
    })),
    summary: '完成源码核验',
  };
  expect(mergeGitComparison(comparison, confirmed, '审查完成')).toMatchObject({
    sections: [...confirmed.sections, comparison.sections[1]],
    summary: '完成源码核验',
  });
});

it('保留每个重复交易键，避免任意选择某一项作为对应交易', () => {
  const before = selection('old', [
    section('payment', '支付', 'pay', [
      transaction('one', 'web', 'v1', '单笔'),
      transaction('two', 'web', 'v1', '批量'),
    ]),
  ]);
  const after = selection('new', [section('payment', '支付', 'pay', [transaction('only', 'web', 'v1', '单笔')])]);
  const comparison = buildGitComparison(before, after, []);

  expect(comparison.transactions.map(({ status, fromId, toId }) => [status, fromId, toId])).toEqual([
    [GitComparisonStatus.Uncertain, 'one', undefined],
    [GitComparisonStatus.Uncertain, 'two', undefined],
    [GitComparisonStatus.Uncertain, undefined, 'only'],
  ]);
});

it('参考设计和缺失快照只给出源码分析上下文，禁止伪造设计引用', () => {
  const reference = selection('reference', [section('ref', '参考专用标题', 'src')], DesignKnowledgeMatch.Reference);
  const comparison = buildGitComparison(missing, reference, []);
  expect(comparison).toMatchObject({
    fromMatch: DesignKnowledgeMatch.Missing,
    toMatch: DesignKnowledgeMatch.Reference,
    toDesignId: 'reference',
    sections: [],
    transactions: [],
  });
  expect(renderGitComparison(comparison)).toContain('只有 exact 初筛项允许引用设计节点 ID');
  expect(renderGitComparison(comparison)).not.toContain('参考专用标题');
  expect(() =>
    mergeGitComparison(
      comparison,
      { ...comparison, sections: [{ status: GitComparisonStatus.Added, title: '入口', toId: 'ref' }] },
      '审查完成',
    ),
  ).toThrow(expect.objectContaining({ code: ErrorCode.ValidationFailed }));
  expect(() =>
    mergeGitComparison(comparison, { ...comparison, toMatch: DesignKnowledgeMatch.Exact }, '审查完成'),
  ).toThrow(expect.objectContaining({ code: ErrorCode.ValidationFailed }));
  expect(() => mergeGitComparison(undefined, comparison, '审查完成')).toThrow(
    expect.objectContaining({ code: ErrorCode.ValidationFailed }),
  );
  expect(mergeGitComparison(comparison, undefined, ' 审查完成 ')).toEqual({ ...comparison, summary: '审查完成' });
  expect(() => mergeGitComparison(comparison, undefined, '  ')).toThrow(
    expect.objectContaining({
      code: ErrorCode.ValidationFailed,
      details: { issues: [expect.objectContaining({ path: ['summary'] })] },
    }),
  );
  expect(mergeGitComparison(undefined, undefined, '  ')).toBeUndefined();
});

it('源码补充必须引用对应端点，节省提示词预算时优先保留有变化的条目', () => {
  const reference = buildGitComparison(missing, missing, []);
  const sources = [{ status: GitComparisonStatus.Added, title: '入口', toPath: 'src/index.ts' }];
  const model = { ...reference, sections: sources, summary: '源码新增入口' };
  expect(mergeGitComparison(reference, model, '审查完成')).toEqual(model);
  expect(() =>
    mergeGitComparison(
      reference,
      { ...model, sections: [{ status: GitComparisonStatus.Added, title: '无路径' }] },
      '审查完成',
    ),
  ).toThrow(expect.objectContaining({ code: ErrorCode.ValidationFailed }));

  const comparison = {
    ...model,
    sections: [
      ...Array.from({ length: 400 }, (_, i) => ({
        status: GitComparisonStatus.Unchanged,
        title: '旧章节'.repeat(20),
        fromId: `stable-${i}`,
      })),
      ...sources,
    ],
  };
  const budget = DESIGN_IMPACT_PROMPT_MAX_BYTES / 2;
  const prompt = renderGitComparison(comparison, budget);
  expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(budget);
  expect(prompt).toContain('src/index.ts');
  expect(prompt).toContain('超出提示词预算');
});

it('同范围改名与缺少交易身份的同名条目只作为待确认的候选', () => {
  const anonymous = (diagramId: string): DesignTransaction => ({
    type: 'transaction',
    title: '支付',
    diagramId,
    evidence: [{ evidenceClass: DesignEvidenceClass.Inferred, rationale: '调用支付处理器' }],
  });
  const oldDesign = selection('old', [section('previous', '旧标题', 'payment', [anonymous('old-tx')])]);
  const newDesign = selection('new', [section('current', '新标题', 'payment', [anonymous('new-tx')])]);
  const comparison = buildGitComparison(oldDesign, newDesign, []);

  expect(comparison.sections).toEqual([
    {
      status: GitComparisonStatus.Uncertain,
      title: '新标题',
      fromId: 'previous',
      toId: 'current',
      detail: '可能存在改名或范围调整，需核实 Git 两端源码。',
    },
  ]);
  expect(comparison.transactions).toEqual([
    {
      status: GitComparisonStatus.Uncertain,
      title: '支付',
      fromId: 'old-tx',
      toId: 'new-tx',
      detail: '交易身份信息不完整，需核实源码中的交易码、渠道与版本。',
    },
  ]);
});

it('实体的双侧源码链接使用同一路径或 Git 确认改名，避免组合无关文件', () => {
  const before = selection(
    'old',
    [section('old-pay', '支付', 'pay'), section('old-cart', '购物车', 'cart')],
    DesignKnowledgeMatch.Exact,
    ['pay/delete.ts', 'pay/common.ts', 'cart/old.ts'],
  );
  const after = selection(
    'new',
    [section('new-pay', '支付', 'pay'), section('new-cart', '购物车', 'cart')],
    DesignKnowledgeMatch.Exact,
    ['pay/create.ts', 'pay/common.ts', 'cart/new.ts'],
  );
  const comparison = buildGitComparison(before, after, [
    { status: DiffFileStatus.Deleted, path: 'pay/delete.ts' },
    { status: DiffFileStatus.Added, path: 'pay/create.ts' },
    { status: DiffFileStatus.Modified, path: 'pay/common.ts' },
    { status: DiffFileStatus.Deleted, path: 'cart/old.ts' },
    { status: DiffFileStatus.Added, path: 'cart/new.ts' },
  ]);

  expect(comparison.sections).toEqual([
    {
      status: GitComparisonStatus.Modified,
      title: '支付',
      fromId: 'old-pay',
      toId: 'new-pay',
      fromPath: 'pay/common.ts',
      toPath: 'pay/common.ts',
    },
    {
      status: GitComparisonStatus.Modified,
      title: '购物车',
      fromId: 'old-cart',
      toId: 'new-cart',
      toPath: 'cart/new.ts',
    },
  ]);
});

it('参考设计的源码示例能直接提交，错误提交能定位到应补的路径和不应引用的 ID', () => {
  const ref = selection('reference', [section('fee-section', '手续费', 'fees')], DesignKnowledgeMatch.Reference);
  const baseline = buildGitComparison(ref, ref, []);
  const prompt = renderGitComparison(baseline);
  const example = prompt.split('\n').find((line) => line.startsWith('{"status":"modified"'));
  assert.isDefined(example);
  const source = gitComparisonItemSchema.parse(JSON.parse(example));
  expect(source).toMatchObject({ status: 'modified', fromPath: expect.any(String), toPath: expect.any(String) });
  const submit = (row: GitComparisonItemDTO) => mergeGitComparison(baseline, { ...baseline, sections: [row] }, '完成');
  expect(submit(source)?.sections).toEqual([source]);

  for (const [row, hint] of [
    [{ status: 'modified', title: '手续费' }, /fromPath.*toPath/],
    [{ status: 'uncertain', title: '手续费' }, /fromPath or toPath/],
    [{ ...source, fromId: 'fee-section', toId: 'fee-section' }, /omit fromId and toId/],
  ] as const) {
    expect(() => submit(row)).toThrow(
      expect.objectContaining({
        code: ErrorCode.ValidationFailed,
        details: {
          issues: [
            expect.objectContaining({ path: ['comparison', 'sections', 0], message: expect.stringMatching(hint) }),
          ],
        },
      }),
    );
  }
});
