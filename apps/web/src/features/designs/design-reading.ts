import {
  type DesignBlock,
  type DesignDiagramNode,
  type DesignDTO,
  type DesignFileDTO,
  type DesignRunDTO,
  DesignRunKind,
  type DesignSectionDTO,
} from '@aw/shared';

export type ReadingTarget =
  | { kind: 'section'; sectionId: string }
  | { kind: 'file'; sectionId: string; fileId: string; symbolId?: string }
  | { kind: 'diagram'; sectionId: string; diagramId: string };

export function targetKey(target: ReadingTarget): string {
  if (target.kind === 'section') return `section:${target.sectionId}`;
  if (target.kind === 'diagram') return `diagram:${target.diagramId}`;
  return `file:${target.fileId}${target.symbolId === undefined ? '' : `:${target.symbolId}`}`;
}

export function fileTarget(file: DesignFileDTO, sectionId: string, symbolId?: string): ReadingTarget {
  return {
    kind: 'file',
    sectionId: file.sectionId ?? sectionId,
    fileId: file.id,
    ...(symbolId === undefined ? {} : { symbolId }),
  };
}

/** 已提交的章节由写入该内容的尝试确定，复审更新时间不会触发跟随跳转。 */
export function followedSection(
  runs: readonly Pick<DesignRunDTO, 'kind' | 'doneSectionIds'>[],
  selected: readonly Pick<DesignSectionDTO, 'id'>[],
): string | undefined {
  const sectionIds = new Set(selected.map(({ id }) => id));
  for (const run of runs.toReversed()) {
    if (run.kind !== DesignRunKind.Generate && run.kind !== DesignRunKind.Revise) continue;
    const latest = run.doneSectionIds.findLast((id) => sectionIds.has(id));
    if (latest !== undefined) return latest;
  }
  return selected[0]?.id;
}

function blockText(block: DesignBlock): string[] {
  switch (block.type) {
    case 'markdown':
      return [block.title ?? '', block.markdown];
    case 'callout':
      return [block.title, block.body];
    case 'code':
      return [block.title ?? '', block.relPath, block.code];
    case 'table':
      return [block.title, block.caption ?? '', ...block.columns, ...block.rows.flat()];
    case 'diagram_ref':
      return [];
  }
}

export type ReadingSearchItem = { label: string; caption: string; haystack: string; target: ReadingTarget };

export function readingIndex(design: Pick<DesignDTO, 'sections' | 'diagrams' | 'files'>): ReadingSearchItem[] {
  const sections = new Map(design.sections.filter(({ selected }) => selected).map((section) => [section.id, section]));
  const items: ReadingSearchItem[] = [];
  function add(label: string, caption: string, terms: string[], target: ReadingTarget): void {
    items.push({ label, caption, haystack: [label, caption, ...terms].join(' ').toLocaleLowerCase(), target });
  }
  for (const { id, title, summary, scopePaths, blocks } of sections.values()) {
    add(title, scopePaths.join(' · '), [summary, ...(blocks ?? []).flatMap(blockText)], {
      kind: 'section',
      sectionId: id,
    });
  }
  for (const file of design.files) {
    if (file.sectionId === null || !sections.has(file.sectionId) || file.responsibility === null) continue;
    const section = sections.get(file.sectionId);
    add(file.relPath, section?.title ?? '', [file.responsibility], fileTarget(file, file.sectionId));
    for (const symbol of file.symbols) {
      add(
        symbol.qualifiedName,
        file.relPath,
        [symbol.name, symbol.summary, symbol.signature ?? ''],
        fileTarget(file, file.sectionId, symbol.id),
      );
    }
  }
  for (const graph of design.diagrams) {
    const section = sections.get(graph.sectionId);
    if (section === undefined) continue;
    add(
      graph.title,
      section.title,
      graph.nodes.flatMap(({ label, summary }) => [label, summary ?? '']),
      {
        kind: 'diagram',
        sectionId: graph.sectionId,
        diagramId: graph.id,
      },
    );
  }
  return items;
}

export function matchingReadingItems(items: readonly ReadingSearchItem[], query: string): ReadingSearchItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return words.length === 0 ? [] : items.filter(({ haystack }) => words.every((word) => haystack.includes(word)));
}

export function graphNodeTarget(
  design: DesignDTO,
  sectionId: string,
  node: DesignDiagramNode,
): ReadingTarget | undefined {
  if (node.targetKind === 'section' || node.targetKind === 'module') {
    const target = design.sections.find(
      ({ id, selected, title }) => selected && (id === node.targetId || title === node.targetId),
    );
    if (target !== undefined) return { kind: 'section', sectionId: target.id };
  }
  const file = design.files.find(
    ({ id, relPath }) => id === node.targetId || relPath === node.relPath || relPath === node.targetId,
  );
  if (node.targetKind === 'symbol') {
    for (const candidate of file === undefined ? design.files : [file]) {
      const symbol = candidate.symbols.find(
        ({ id, qualifiedName }) => id === node.targetId || qualifiedName === node.targetId,
      );
      if (symbol !== undefined) return fileTarget(candidate, sectionId, symbol.id);
    }
  }
  return file === undefined ? undefined : fileTarget(file, sectionId);
}

export function progressSection(run: DesignRunDTO | undefined): string | undefined {
  return run?.targetSectionIds.find((id) => !run.doneSectionIds.includes(id));
}
