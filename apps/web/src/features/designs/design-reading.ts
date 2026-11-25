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
  | { kind: 'overview' }
  | { kind: 'section'; sectionId: string }
  | { kind: 'submodule'; sectionId: string; submoduleId: string }
  | { kind: 'file'; sectionId: string; fileId: string; symbolId?: string; lines?: { start: number; end: number } }
  | { kind: 'diagram'; sectionId: string; diagramId: string };

export function targetKey(target: ReadingTarget): string {
  if (target.kind === 'overview') return 'overview';
  if (target.kind === 'section') return `section:${target.sectionId}`;
  if (target.kind === 'submodule') return `submodule:${target.sectionId}:${target.submoduleId}`;
  if (target.kind === 'diagram') return `diagram:${target.diagramId}`;
  return `file:${target.fileId}:${target.symbolId ?? ''}:${target.lines?.start ?? ''}:${target.lines?.end ?? ''}`;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export type DesignSubmodule = Extract<DesignBlock, { type: 'submodule' }>;

export function submodulesOf(section: DesignSectionDTO): DesignSubmodule[] {
  return section.blocks?.filter((block) => block.type === 'submodule') ?? [];
}

export function fileSubmodule(file: DesignFileDTO, section: DesignSectionDTO): DesignSubmodule | undefined {
  return submodulesOf(section).find(({ files }) => files.includes(file.relPath));
}

export function fileTarget(
  file: DesignFileDTO,
  sectionId: string,
  symbolId?: string,
  lines?: { start: number; end: number },
): Extract<ReadingTarget, { kind: 'file' }> {
  return {
    kind: 'file',
    sectionId: file.sectionId ?? sectionId,
    fileId: file.id,
    ...(symbolId === undefined ? {} : { symbolId }),
    ...(lines === undefined ? {} : { lines }),
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
    case 'submodule':
      return [];
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
    for (const block of blocks ?? []) {
      if (block.type !== 'submodule') continue;
      add(
        block.title,
        title,
        [block.summary, ...block.files, ...block.behaviors.flatMap(({ title, markdown }) => [title, markdown])],
        {
          kind: 'submodule',
          sectionId: id,
          submoduleId: block.id,
        },
      );
    }
  }
  for (const file of design.files) {
    if (file.sectionId === null || !sections.has(file.sectionId) || file.responsibility === null) continue;
    const section = sections.get(file.sectionId);
    add(
      basename(file.relPath),
      file.relPath,
      [file.responsibility, section?.title ?? ''],
      fileTarget(file, file.sectionId),
    );
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
    for (const chapter of design.sections) {
      if (!chapter.selected) continue;
      const module = submodulesOf(chapter).find(({ id, title }) => id === node.targetId || title === node.targetId);
      if (module !== undefined) return { kind: 'submodule', sectionId: chapter.id, submoduleId: module.id };
    }
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
