import { DesignReviewState, DesignRunKind, DesignSectionKind } from '@aw/shared';
import { expect, it } from 'vitest';
import { followedSection, matchingReadingItems, readingIndex } from './design-reading.ts';

it('读到最近提交的章节，后续复审或尚未提交的运行不会跳离正文', () => {
  const first = { id: 'overview' };
  const second = { id: 'module' };
  const runs = [
    { kind: DesignRunKind.Generate, doneSectionIds: [first.id, second.id] },
    { kind: DesignRunKind.Review, doneSectionIds: [first.id] },
    { kind: DesignRunKind.Revise, doneSectionIds: [] },
  ];
  expect(followedSection([], [first, second])).toBe(first.id);
  expect(followedSection(runs, [first, second])).toBe(second.id);
  expect(followedSection([...runs, { kind: DesignRunKind.Revise, doneSectionIds: [first.id] }], [first, second])).toBe(
    first.id,
  );
});

it('跨章节正文、相对路径、英文符号及说明检索，排除未选章节', () => {
  const section = {
    id: 'overview',
    seq: 1,
    kind: DesignSectionKind.Overview,
    title: '运行入口',
    selected: true,
    scopePaths: ['packages/refunds'],
    summary: '初始化说明',
    blocks: [{ type: 'markdown' as const, markdown: '异常时记录重试原因' }],
    reviewState: DesignReviewState.None,
    reviewNotes: null,
    hasPrevious: false,
    updatedAt: 1,
  };
  const index = readingIndex({
    sections: [section, { ...section, id: 'unused', title: '未选候选项', selected: false }],
    diagrams: [],
    files: [
      {
        id: 'file',
        sectionId: section.id,
        responsibility: '创建退款记录',
        contentHash: 'hash',
        relPath: 'packages/refunds/src/order.ts',
        updatedAt: 1,
        symbols: [
          {
            id: 'symbol',
            name: 'buildRefund',
            qualifiedName: 'Order.buildRefund',
            kind: 'method',
            lineStart: 1,
            lineEnd: 5,
            summary: '组装退款主体',
          },
        ],
      },
    ],
  });
  expect(matchingReadingItems(index, '异常 重试').map(({ label }) => label)).toEqual(['运行入口']);
  expect(matchingReadingItems(index, 'refunds BUILdREFund').map(({ target }) => target)).toEqual([
    { kind: 'file', sectionId: section.id, fileId: 'file', symbolId: 'symbol' },
  ]);
  expect(matchingReadingItems(index, '未选候选项')).toEqual([]);
});
