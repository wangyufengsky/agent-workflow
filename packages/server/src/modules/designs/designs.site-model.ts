import {
  type DesignSourceSnapshot,
  layoutDesignDiagram,
  presentTransactionDiagram,
  TRANSACTION_EXPLORER_KEY,
} from '@aw/shared';
import type { DesignDiagramRecord, DesignFile, DesignSection, ProjectDesign } from './designs.records.ts';

export type DesignSiteContents = {
  design: ProjectDesign;
  sections: readonly DesignSection[];
  files: readonly DesignFile[];
  diagrams: readonly DesignDiagramRecord[];
  exportedAt: number;
};

export function designSiteModel({ design, sections, files, diagrams, exportedAt }: DesignSiteContents) {
  const completed = sections.filter(
    (section): section is DesignSection & { blocks: NonNullable<DesignSection['blocks']> } =>
      section.selected && section.blocks !== null,
  );
  const chapterIds = new Set(completed.map(({ id }) => id));
  const excerptChapters = new Map<string, string>();
  for (const section of completed) {
    for (const block of section.blocks) {
      if (block.type === 'code' && !excerptChapters.has(block.relPath)) excerptChapters.set(block.relPath, section.id);
    }
  }
  const siteFiles = files.flatMap<Pick<DesignFile, 'id' | 'sectionId' | 'relPath' | 'responsibility' | 'symbols'>>(
    ({ id, sectionId, relPath, responsibility, symbols }) => {
      if (sectionId !== null && chapterIds.has(sectionId) && responsibility !== null) {
        return [{ id, sectionId, relPath, responsibility, symbols }];
      }
      const excerptSectionId = excerptChapters.get(relPath);
      return excerptSectionId === undefined
        ? []
        : [{ id, sectionId: excerptSectionId, relPath, responsibility: null, symbols: [] }];
    },
  );
  const transactions = new Map(
    completed.flatMap(({ blocks }) =>
      blocks.flatMap((block) => (block.type === 'transaction' ? [[block.diagramId, block] as const] : [])),
    ),
  );
  const graphs = diagrams
    .filter(({ sectionId }) => chapterIds.has(sectionId))
    .map(({ id, sectionId, kind, title, nodes, edges }) => {
      const diagram = { id, sectionId, kind, title, nodes, edges };
      const transaction = transactions.get(id);
      if (!transaction) return { ...diagram, layout: layoutDesignDiagram(nodes, edges) };
      const { layout, ...presentation } = presentTransactionDiagram(nodes, edges, files, transaction);
      return { ...diagram, layout, presentation };
    });
  return {
    schemaVersion: 1,
    designId: design.id,
    title: design.title,
    transactionExplorer: design.templateSnapshot.key === TRANSACTION_EXPLORER_KEY || transactions.size > 0,
    theme: design.theme,
    layoutStyle: design.layoutStyle,
    depth: design.depth,
    exportedAt,
    sourceSnapshot: publicSourceSnapshot(design.sourceSnapshot),
    sections: completed.map(({ id, seq, kind, title, summary, blocks }) => ({
      id,
      seq,
      kind,
      title,
      summary,
      blocks,
    })),
    files: siteFiles,
    diagrams: graphs,
  };
}

function publicSourceSnapshot(snapshot: DesignSourceSnapshot): DesignSourceSnapshot {
  return {
    branch: snapshot.branch,
    commitSha: snapshot.commitSha,
    dirty: snapshot.dirty,
    scannedAt: snapshot.scannedAt,
    analyzableCount: snapshot.analyzableCount,
    skippedCount: snapshot.skippedCount,
    skippedReasons: snapshot.skippedReasons,
    techStack: snapshot.techStack,
  };
}

export type DesignSiteModel = ReturnType<typeof designSiteModel>;

/** 经典脚本在 file:// 可直接加载。这些转义也防止数据误嵌入 HTML 时闭合 script。 */
export function scriptJson(json: string): string {
  return json.replace(
    /[<>&\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function siteDataScript(modelJson: string): string {
  return `window.__AW_DESIGN_DATA__ = ${scriptJson(modelJson)};\n`;
}
