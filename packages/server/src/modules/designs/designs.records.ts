import {
  type DesignBlock,
  type DesignDepth,
  type DesignDiagram,
  type DesignLayoutStyle,
  type DesignReviewNote,
  type DesignReviewState,
  type DesignSectionKind,
  type DesignSectionVersion,
  type DesignSourceHashes,
  type DesignSourceSnapshot,
  type DesignSymbol,
  type DesignTemplate,
  type DesignTemplateSnapshot,
  designBlockSchema,
  designDepthSchema,
  designDiagramSchema,
  designLayoutStyleSchema,
  designReviewNoteSchema,
  designReviewStateSchema,
  designSectionKindSchema,
  designSectionVersionSchema,
  designSourceHashesSchema,
  designSourceSnapshotSchema,
  designSymbolSchema,
  designTemplateSchema,
  designTemplateSnapshotSchema,
  permissionModeSchema,
  type ThemeId,
  themeIdSchema,
} from '@aw/shared';
import { z } from 'zod';
import type {
  designDiagramsTable,
  designFilesTable,
  designRunsTable,
  designSectionsTable,
  designTemplatesTable,
  projectDesignsTable,
} from './designs.table.ts';

type DesignRow = typeof projectDesignsTable.$inferSelect;
type SectionRow = typeof designSectionsTable.$inferSelect;
type FileRow = typeof designFilesTable.$inferSelect;
type DiagramRow = typeof designDiagramsTable.$inferSelect;
type RunRow = typeof designRunsTable.$inferSelect;
type TemplateRow = typeof designTemplatesTable.$inferSelect;

export type ProjectDesign = Omit<
  DesignRow,
  'depth' | 'layoutStyle' | 'theme' | 'excludePatterns' | 'sourceSnapshot' | 'templateSnapshot'
> & {
  depth: DesignDepth;
  layoutStyle: DesignLayoutStyle;
  theme: ThemeId;
  excludePatterns: string[];
  sourceSnapshot: DesignSourceSnapshot;
  templateSnapshot: DesignTemplateSnapshot;
};

export type DesignSection = Omit<
  SectionRow,
  'kind' | 'scopePaths' | 'blocks' | 'reviewState' | 'reviewNotes' | 'previous' | 'sourceHashes'
> & {
  kind: DesignSectionKind;
  scopePaths: string[];
  blocks: DesignBlock[] | null;
  reviewState: DesignReviewState;
  reviewNotes: DesignReviewNote[] | null;
  previous: DesignSectionVersion | null;
  sourceHashes?: DesignSourceHashes | null;
};

export type DesignFile = Omit<FileRow, 'symbols'> & { symbols: DesignSymbol[] };
export type DesignDiagramRecord = DesignDiagram & Pick<DiagramRow, 'designId' | 'sectionId' | 'updatedAt'>;
export type DesignRun = Omit<RunRow, 'targetSectionIds' | 'doneSectionIds' | 'isIncremental'> & {
  targetSectionIds: string[];
  doneSectionIds: string[];
  isIncremental?: boolean;
};

const stringsSchema = z.array(z.string());
const blocksSchema = z.array(designBlockSchema);
const reviewNotesSchema = z.array(designReviewNoteSchema);
const symbolsSchema = z.array(designSymbolSchema);

const json = <T>(schema: z.ZodType<T>, raw: string): T => schema.parse(JSON.parse(raw));
const nullableJson = <T>(schema: z.ZodType<T>, raw: string | null): T | null =>
  raw === null ? null : json(schema, raw);
const nullableStringify = (value: object | null): string | null => (value === null ? null : JSON.stringify(value));

export const toDesign = (row: DesignRow): ProjectDesign => ({
  ...row,
  depth: designDepthSchema.parse(row.depth),
  permissionMode: permissionModeSchema.parse(row.permissionMode),
  layoutStyle: designLayoutStyleSchema.parse(row.layoutStyle),
  theme: themeIdSchema.parse(row.theme),
  excludePatterns: json(stringsSchema, row.excludePatterns),
  sourceSnapshot: json(designSourceSnapshotSchema, row.sourceSnapshot),
  templateSnapshot: json(designTemplateSnapshotSchema, row.templateSnapshot),
});
export const fromDesign = (design: ProjectDesign): DesignRow => ({
  ...design,
  excludePatterns: JSON.stringify(design.excludePatterns),
  sourceSnapshot: JSON.stringify(design.sourceSnapshot),
  templateSnapshot: JSON.stringify(design.templateSnapshot),
});

export const toSection = ({ sourceHashes, ...row }: SectionRow): DesignSection => ({
  ...row,
  kind: designSectionKindSchema.parse(row.kind),
  scopePaths: json(stringsSchema, row.scopePaths),
  blocks: nullableJson(blocksSchema, row.blocks),
  reviewState: designReviewStateSchema.parse(row.reviewState),
  reviewNotes: nullableJson(reviewNotesSchema, row.reviewNotes),
  previous: nullableJson(designSectionVersionSchema, row.previous),
  ...(sourceHashes === null ? {} : { sourceHashes: json(designSourceHashesSchema, sourceHashes) }),
});
export const fromSection = (section: DesignSection): SectionRow => ({
  ...section,
  scopePaths: JSON.stringify(section.scopePaths),
  blocks: nullableStringify(section.blocks),
  reviewNotes: nullableStringify(section.reviewNotes),
  previous: nullableStringify(section.previous),
  sourceHashes: nullableStringify(section.sourceHashes ?? null),
});

export const toFile = (row: FileRow): DesignFile => ({ ...row, symbols: json(symbolsSchema, row.symbols) });
export const fromFile = (file: DesignFile): FileRow => ({ ...file, symbols: JSON.stringify(file.symbols) });

export const toDiagram = ({
  designId,
  sectionId,
  updatedAt,
  nodes,
  edges,
  ...row
}: DiagramRow): DesignDiagramRecord => ({
  ...designDiagramSchema.parse({ ...row, nodes: JSON.parse(nodes), edges: JSON.parse(edges) }),
  designId,
  sectionId,
  updatedAt,
});
export const fromDiagram = (diagram: DesignDiagramRecord): DiagramRow => ({
  ...diagram,
  nodes: JSON.stringify(diagram.nodes),
  edges: JSON.stringify(diagram.edges),
});

export const toRun = ({ isIncremental, ...row }: RunRow): DesignRun => ({
  ...row,
  ...(isIncremental ? { isIncremental } : {}),
  targetSectionIds: json(stringsSchema, row.targetSectionIds),
  doneSectionIds: json(stringsSchema, row.doneSectionIds),
});
export const fromRun = (run: DesignRun): RunRow => ({
  ...run,
  targetSectionIds: JSON.stringify(run.targetSectionIds),
  doneSectionIds: JSON.stringify(run.doneSectionIds),
  isIncremental: run.isIncremental ?? false,
});

export const toTemplate = ({ matchHints, defaultSections, ...row }: TemplateRow): DesignTemplate =>
  designTemplateSchema.parse({
    ...row,
    matchHints: JSON.parse(matchHints),
    defaultSections: JSON.parse(defaultSections),
  });
export const fromTemplate = (template: DesignTemplate): TemplateRow => ({
  ...template,
  matchHints: JSON.stringify(template.matchHints),
  defaultSections: JSON.stringify(template.defaultSections),
});
