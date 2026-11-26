import type { DesignSourceHashes, DesignSourceSnapshot, DesignTemplate } from '@aw/shared';
import { and, asc, desc, eq, exists, inArray, isNotNull, lt, notExists, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import {
  type DesignDiagramRecord,
  type DesignFile,
  type DesignRun,
  type DesignSection,
  fromDesign,
  fromDiagram,
  fromFile,
  fromRun,
  fromSection,
  fromTemplate,
  type ProjectDesign,
  toDesign,
  toDiagram,
  toFile,
  toRun,
  toSection,
  toTemplate,
} from './designs.records.ts';
import {
  projectDesignsTable as designs,
  designDiagramsTable as diagrams,
  designFilesTable as files,
  designRunsTable as runs,
  designSectionsTable as sections,
  designTemplatesTable as templates,
} from './designs.table.ts';

export type { DesignDiagramRecord, DesignFile, DesignRun, DesignSection, ProjectDesign } from './designs.records.ts';

/** 按批分开参数，避免大型仓库一次写入超过 SQLite 参数上限。事务由 service 持有。 */
const FILES_PER_BATCH = 1000;

function knowledgeDesigns(db: DbExecutor, projectId: string, targetSha?: string) {
  const completed = db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.designId, designs.id), eq(sections.selected, true), isNotNull(sections.blocks)));
  const mixed = db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.designId, designs.id), isNotNull(sections.sourceHashes)));
  const baseline =
    targetSha === undefined
      ? undefined
      : and(
          sql`json_extract(${designs.sourceSnapshot}, '$.commitSha') = ${targetSha}
            and json_extract(${designs.sourceSnapshot}, '$.dirty') = 0`,
          notExists(mixed),
        );
  return db
    .select()
    .from(designs)
    .where(and(eq(designs.projectId, projectId), exists(completed), baseline))
    .orderBy(desc(designs.updatedAt), desc(designs.id));
}

export function createDesignsRepo(db: DbExecutor) {
  return {
    insertDesign(design: ProjectDesign): void {
      db.insert(designs).values(fromDesign(design)).run();
    },
    findDesign(id: string): ProjectDesign | undefined {
      const row = db.select().from(designs).where(eq(designs.id, id)).get();
      return row === undefined ? undefined : toDesign(row);
    },
    findLatestKnowledgeDesign(projectId: string, targetSha?: string): ProjectDesign | undefined {
      const row = knowledgeDesigns(db, projectId, targetSha).limit(1).get();
      return row === undefined ? undefined : toDesign(row);
    },
    listKnowledgeDesigns(projectId: string, targetSha?: string): ProjectDesign[] {
      return knowledgeDesigns(db, projectId, targetSha).all().map(toDesign);
    },
    page(
      filter: { projectId?: string | undefined; query?: string | undefined },
      after: { updatedAt: number; id: string } | undefined,
      limit: number,
    ): ProjectDesign[] {
      const conditions: SQL[] = [];
      if (filter.projectId !== undefined) conditions.push(eq(designs.projectId, filter.projectId));
      if (filter.query !== undefined) {
        const query = `%${filter.query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        conditions.push(sql`${designs.title} like ${query} escape '\\'`);
      }
      if (after !== undefined) {
        const older = or(
          lt(designs.updatedAt, after.updatedAt),
          and(eq(designs.updatedAt, after.updatedAt), lt(designs.id, after.id)),
        );
        if (older !== undefined) conditions.push(older);
      }
      return db
        .select()
        .from(designs)
        .where(and(...conditions))
        .orderBy(desc(designs.updatedAt), desc(designs.id))
        .limit(limit)
        .all()
        .map(toDesign);
    },
    sectionCounts(designIds: readonly string[]) {
      if (designIds.length === 0) return [];
      return db
        .select({
          designId: sections.designId,
          totalSections: sql<number>`count(*)`.mapWith(Number),
          doneSections: sql<number>`count(${sections.blocks})`.mapWith(Number),
        })
        .from(sections)
        .where(and(inArray(sections.designId, designIds), eq(sections.selected, true)))
        .groupBy(sections.designId)
        .all();
    },
    analyzedCounts(designIds: readonly string[]) {
      if (designIds.length === 0) return [];
      return db
        .select({
          designId: files.designId,
          analyzedCount: sql<number>`count(${files.responsibility})`.mapWith(Number),
        })
        .from(files)
        .where(inArray(files.designId, designIds))
        .groupBy(files.designId)
        .all();
    },
    latestRuns(designIds: readonly string[]): DesignRun[] {
      if (designIds.length === 0) return [];
      const latest = db
        .select({
          designId: runs.designId,
          seq: sql<number>`max(${runs.seq})`.as('latest_seq'),
        })
        .from(runs)
        .where(inArray(runs.designId, designIds))
        .groupBy(runs.designId)
        .as('latest_runs');
      return db
        .select({ run: runs })
        .from(runs)
        .innerJoin(latest, and(eq(latest.designId, runs.designId), eq(latest.seq, runs.seq)))
        .all()
        .map(({ run }) => toRun(run));
    },
    updateDesign(
      id: string,
      patch: Partial<
        Pick<
          ProjectDesign,
          | 'title'
          | 'layoutStyle'
          | 'theme'
          | 'aiReviewEnabled'
          | 'outlineConfirmedAt'
          | 'lastExportedPath'
          | 'lastExportedAt'
          | 'updatedAt'
        >
      >,
    ): void {
      db.update(designs).set(patch).where(eq(designs.id, id)).run();
    },
    setSourceSnapshot(id: string, snapshot: DesignSourceSnapshot): void {
      db.update(designs)
        .set({ sourceSnapshot: JSON.stringify(snapshot) })
        .where(eq(designs.id, id))
        .run();
    },
    hasSectionSourceHashes(designId: string): boolean {
      return (
        db
          .select({ id: sections.id })
          .from(sections)
          .where(and(eq(sections.designId, designId), isNotNull(sections.sourceHashes)))
          .get() !== undefined
      );
    },
    setSectionSourceHashes(designId: string, sectionId: string, hashes: DesignSourceHashes): void {
      db.update(sections)
        .set({ sourceHashes: JSON.stringify(hashes) })
        .where(and(eq(sections.designId, designId), eq(sections.id, sectionId)))
        .run();
    },
    clearSectionSourceHashes(designId: string): void {
      db.update(sections).set({ sourceHashes: null }).where(eq(sections.designId, designId)).run();
    },
    deleteDesign(id: string): void {
      db.delete(designs).where(eq(designs.id, id)).run();
    },
    insertSections(items: readonly DesignSection[]): void {
      if (items.length > 0) db.insert(sections).values(items.map(fromSection)).run();
    },
    listSections(designId: string): DesignSection[] {
      return db
        .select()
        .from(sections)
        .where(eq(sections.designId, designId))
        .orderBy(asc(sections.seq))
        .all()
        .map(toSection);
    },
    updateSection(section: DesignSection): void {
      const { id, designId, ...row } = fromSection(section);
      db.update(sections)
        .set(row)
        .where(and(eq(sections.id, id), eq(sections.designId, designId)))
        .run();
    },
    deleteSections(designId: string): void {
      db.delete(sections).where(eq(sections.designId, designId)).run();
    },
    insertFiles(items: readonly DesignFile[]): void {
      for (let offset = 0; offset < items.length; offset += FILES_PER_BATCH) {
        db.insert(files)
          .values(items.slice(offset, offset + FILES_PER_BATCH).map(fromFile))
          .run();
      }
    },
    findFile(designId: string, fileId: string): DesignFile | undefined {
      const row = db
        .select()
        .from(files)
        .where(and(eq(files.designId, designId), eq(files.id, fileId)))
        .get();
      return row === undefined ? undefined : toFile(row);
    },
    fileInventory(designId: string) {
      return db
        .select({ relPath: files.relPath, sectionId: files.sectionId })
        .from(files)
        .where(eq(files.designId, designId))
        .orderBy(asc(files.relPath))
        .all();
    },
    sectionFiles(designId: string, sectionId: string): DesignFile[] {
      return db
        .select()
        .from(files)
        .where(and(eq(files.designId, designId), eq(files.sectionId, sectionId)))
        .orderBy(asc(files.relPath))
        .all()
        .map(toFile);
    },
    listFiles(designId: string): DesignFile[] {
      return db.select().from(files).where(eq(files.designId, designId)).orderBy(asc(files.relPath)).all().map(toFile);
    },
    updateFileHash(designId: string, id: string, contentHash: string): void {
      db.update(files)
        .set({ contentHash })
        .where(and(eq(files.designId, designId), eq(files.id, id)))
        .run();
    },
    deleteFiles(designId: string, ids: readonly string[]): void {
      for (let offset = 0; offset < ids.length; offset += FILES_PER_BATCH) {
        db.delete(files)
          .where(and(eq(files.designId, designId), inArray(files.id, ids.slice(offset, offset + FILES_PER_BATCH))))
          .run();
      }
    },
    updateFile(file: DesignFile): void {
      const { id, designId, relPath: _relPath, contentHash: _hash, ...row } = fromFile(file);
      db.update(files)
        .set(row)
        .where(and(eq(files.id, id), eq(files.designId, designId)))
        .run();
    },
    insertDiagrams(items: readonly DesignDiagramRecord[]): void {
      if (items.length > 0) db.insert(diagrams).values(items.map(fromDiagram)).run();
    },
    listDiagrams(designId: string): DesignDiagramRecord[] {
      return db
        .select()
        .from(diagrams)
        .where(eq(diagrams.designId, designId))
        .orderBy(asc(diagrams.sectionId), asc(diagrams.title), asc(diagrams.id))
        .all()
        .map(toDiagram);
    },
    deleteSectionDiagrams(designId: string, sectionId: string): void {
      db.delete(diagrams)
        .where(and(eq(diagrams.designId, designId), eq(diagrams.sectionId, sectionId)))
        .run();
    },
    insertRun(run: DesignRun): void {
      db.insert(runs).values(fromRun(run)).run();
    },
    listRuns(designId: string): DesignRun[] {
      return db.select().from(runs).where(eq(runs.designId, designId)).orderBy(asc(runs.seq)).all().map(toRun);
    },
    findRunByAttempt(attemptId: string): DesignRun | undefined {
      const row = db.select().from(runs).where(eq(runs.attemptId, attemptId)).get();
      return row === undefined ? undefined : toRun(row);
    },
    updateRunDone(runId: string, doneSectionIds: string[]): void {
      db.update(runs)
        .set({ doneSectionIds: JSON.stringify(doneSectionIds) })
        .where(eq(runs.id, runId))
        .run();
    },
    listTemplates(): DesignTemplate[] {
      return db.select().from(templates).orderBy(asc(templates.kind), asc(templates.key)).all().map(toTemplate);
    },
    findTemplate(key: string): DesignTemplate | undefined {
      const row = db.select().from(templates).where(eq(templates.key, key)).get();
      return row === undefined ? undefined : toTemplate(row);
    },
    upsertTemplate(template: DesignTemplate): void {
      const { key, ...rest } = fromTemplate(template);
      db.insert(templates)
        .values({ key, ...rest })
        .onConflictDoUpdate({ target: templates.key, set: rest })
        .run();
    },
    deleteTemplate(key: string): void {
      db.delete(templates).where(eq(templates.key, key)).run();
    },
  };
}
