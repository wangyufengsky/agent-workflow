import type { ReadDesignSectionInput } from '@aw/shared';
import type { createDesignsRepo, DesignSection } from './designs.repo.ts';

type Repo = ReturnType<typeof createDesignsRepo>;
type Field = ReadDesignSectionInput['field'];
const MATERIAL_BYTES = 16 * 1024;
const PAGE_CHARS = 4096;

function fieldValue(repo: Repo, section: DesignSection, field: Field) {
  switch (field) {
    case 'files':
      return repo.sectionFiles(section.designId, section.id).map(({ relPath, responsibility, symbols }) => ({
        relPath,
        responsibility,
        symbols,
      }));
    case 'diagrams':
      return repo
        .listDiagrams(section.designId)
        .filter(({ sectionId }) => sectionId === section.id)
        .map(({ designId: _design, sectionId: _section, updatedAt: _time, ...diagram }) => diagram);
    default:
      return section[field];
  }
}

/** 大字段只发索引，模型仍可按偏移读回同一个字段的完整 JSON。 */
export function promptSections(repo: Repo, sections: readonly DesignSection[]) {
  const fields = ['scopePaths', 'summary', 'blocks', 'files', 'diagrams'] as const;
  const budget = MATERIAL_BYTES / (sections.length * fields.length);
  return sections.map((section) => {
    const { id, seq, selected, kind, title } = section;
    const material: Record<string, unknown> = {};
    for (const field of fields) {
      if (section.blocks === null && (field === 'files' || field === 'diagrams')) continue;
      const value = fieldValue(repo, section, field);
      const json = JSON.stringify(value);
      material[field] = Buffer.byteLength(json) <= budget ? value : { field, length: json.length };
    }
    return { id, seq, selected, kind, title, ...material };
  });
}

export function readDesignSectionPage(
  repo: Repo,
  section: DesignSection,
  { field, offset = 0 }: ReadDesignSectionInput,
) {
  const json = JSON.stringify(fieldValue(repo, section, field));
  let end = Math.min(json.length, offset + PAGE_CHARS);
  // 保持非 BMP 字符完整，nextOffset 仍以原始 JSON 的 UTF-16 偏移计数。
  const lastUnit = json.charCodeAt(end - 1);
  if (end < json.length && lastUnit >= 0xd800 && lastUnit <= 0xdbff) end--;
  const content = json.slice(offset, end);
  const next = offset + content.length;
  return { content, nextOffset: next < json.length ? next : null };
}
