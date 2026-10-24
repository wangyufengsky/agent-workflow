import {
  type ErrorInfo,
  errorInfoSchema,
  type InitiativeCoverage,
  type InitiativeItemSpec,
  type InitiativePhase,
  type InitiativeTemplateKind,
  type InitiativeUnderstanding,
  initiativeCoverageSchema,
  initiativeItemSpecSchema,
  initiativePhaseSchema,
  initiativeUnderstandingSchema,
  requirementItemInputSchema,
} from '@aw/shared';
import { and, asc, desc, eq, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectsTable } from '../projects/index.ts';
import {
  initiativeItemsTable,
  initiativeRunsTable,
  initiativesTable,
  initiativeTemplatesTable,
} from './initiatives.table.ts';

type InitiativeRow = typeof initiativesTable.$inferSelect;
type ItemRow = typeof initiativeItemsTable.$inferSelect;

/** The JSON columns of an initiative, parsed. */
type InitiativeJson = {
  phases: InitiativePhase[];
  allowedWorkflows: string[] | null;
  understanding: InitiativeUnderstanding | null;
  coverage: InitiativeCoverage[] | null;
};

export type Initiative = Omit<InitiativeRow, keyof InitiativeJson> &
  InitiativeJson & {
    projectName: string;
    template: { key: string; name: string } | null;
  };

export type InitiativeRun = typeof initiativeRunsTable.$inferSelect;

// JSON columns are parsed at the boundary (06 §9).
const json = <T>(schema: z.ZodType<T>, value: string): T => schema.parse(JSON.parse(value));
const nullableJson = <T>(schema: z.ZodType<T>, value: string | null): T | null =>
  value === null ? null : json(schema, value);
const phasesSchema = z.array(initiativePhaseSchema);
const keysSchema = z.array(z.string());
const acceptanceSchema = z.array(requirementItemInputSchema);

/** The JSON columns of an initiative, serialized. */
function columnsOf(fields: { [K in keyof InitiativeJson]?: InitiativeJson[K] | undefined }) {
  return {
    ...(fields.phases === undefined ? {} : { phases: JSON.stringify(fields.phases) }),
    ...(fields.allowedWorkflows === undefined
      ? {}
      : { allowedWorkflows: fields.allowedWorkflows === null ? null : JSON.stringify(fields.allowedWorkflows) }),
    ...(fields.understanding === undefined
      ? {}
      : { understanding: fields.understanding === null ? null : JSON.stringify(fields.understanding) }),
    ...(fields.coverage === undefined
      ? {}
      : { coverage: fields.coverage === null ? null : JSON.stringify(fields.coverage) }),
  };
}

export type InitiativeItem = Omit<ItemRow, 'dependsOn' | 'acceptance' | 'startError'> & {
  dependsOn: string[];
  acceptance: InitiativeItemSpec['acceptance'];
  startError: ErrorInfo | null;
};

export type InitiativeTemplate = {
  id: string;
  key: string;
  kind: InitiativeTemplateKind;
  name: string;
  description: string;
  phases: InitiativePhase[];
  items: InitiativeItemSpec[];
};

const toItem = (row: ItemRow): InitiativeItem => ({
  ...row,
  dependsOn: json(keysSchema, row.dependsOn),
  acceptance: json(acceptanceSchema, row.acceptance),
  startError: nullableJson(errorInfoSchema, row.startError),
});

/** A work package's columns from its spec. */
export const itemColumns = (spec: InitiativeItemSpec) => ({
  key: spec.key,
  title: spec.title,
  phase: spec.phase,
  workflowKey: spec.workflow,
  requirement: spec.requirement,
  dependsOn: JSON.stringify(spec.dependsOn),
  acceptance: JSON.stringify(spec.acceptance),
});

export function createInitiativesRepo(db: DbExecutor) {
  const i = initiativesTable;
  const it = initiativeItemsTable;
  const tpl = initiativeTemplatesTable;
  const select = (where: SQL | undefined) =>
    db
      .select({ initiative: i, projectName: projectsTable.name, templateKey: tpl.key, templateName: tpl.name })
      .from(i)
      .innerJoin(projectsTable, eq(projectsTable.id, i.projectId))
      .leftJoin(tpl, eq(tpl.id, i.templateId))
      .where(where);
  const toInitiative = (row: {
    initiative: InitiativeRow;
    projectName: string;
    templateKey: string | null;
    templateName: string | null;
  }): Initiative => ({
    ...row.initiative,
    phases: json(phasesSchema, row.initiative.phases),
    allowedWorkflows: nullableJson(keysSchema, row.initiative.allowedWorkflows),
    understanding: nullableJson(initiativeUnderstandingSchema, row.initiative.understanding),
    coverage: nullableJson(z.array(initiativeCoverageSchema), row.initiative.coverage),
    projectName: row.projectName,
    template:
      row.templateKey === null || row.templateName === null ? null : { key: row.templateKey, name: row.templateName },
  });

  return {
    /** Numbers the initiative and inserts it; returns its seq. */
    insert(row: Omit<InitiativeRow, 'seq' | keyof InitiativeJson> & InitiativeJson): number {
      const max = db
        .select({ max: sql<number | null>`max(${i.seq})` })
        .from(i)
        .get();
      const seq = (max?.max ?? 0) + 1;
      db.insert(i)
        .values({
          ...row,
          seq,
          phases: JSON.stringify(row.phases),
          allowedWorkflows: row.allowedWorkflows === null ? null : JSON.stringify(row.allowedWorkflows),
          understanding: row.understanding === null ? null : JSON.stringify(row.understanding),
          coverage: row.coverage === null ? null : JSON.stringify(row.coverage),
        })
        .run();
      return seq;
    },
    find(id: string): Initiative | undefined {
      const row = select(eq(i.id, id)).get();
      return row === undefined ? undefined : toInitiative(row);
    },
    /** Newest first; `beforeSeq` is where the previous page ended. */
    page(filter: { projectId: string | undefined; beforeSeq: number | undefined; limit: number }): Initiative[] {
      return select(
        and(
          ...(filter.projectId === undefined ? [] : [eq(i.projectId, filter.projectId)]),
          ...(filter.beforeSeq === undefined ? [] : [lt(i.seq, filter.beforeSeq)]),
        ),
      )
        .orderBy(desc(i.seq))
        .limit(filter.limit)
        .all()
        .map(toInitiative);
    },
    /** Confirmed initiatives that may still have work to start (startup scan, 34 §6.3). */
    confirmedIds(): string[] {
      return db
        .select({ id: i.id })
        .from(i)
        .where(sql`${i.confirmedRev} >= ${i.breakdownRev} and ${i.openedPhase} > 0`)
        .all()
        .map((row) => row.id);
    },
    idsOfProject(projectId: string): string[] {
      return db
        .select({ id: i.id })
        .from(i)
        .where(eq(i.projectId, projectId))
        .all()
        .map((row) => row.id);
    },
    update(
      id: string,
      fields: Partial<Pick<InitiativeRow, 'confirmedRev' | 'breakdownRev' | 'title' | 'summary' | 'updatedAt'>> &
        Partial<Pick<InitiativeJson, 'phases' | 'understanding' | 'coverage'>>,
    ) {
      const { phases, understanding, coverage, ...rest } = fields;
      db.update(i)
        .set({ ...rest, ...columnsOf({ phases, understanding, coverage }) })
        .where(eq(i.id, id))
        .run();
    },
    /** Opens `phase` if the previous one is the last opened; false when another call opened it first. */
    openPhase(id: string, phase: number, now: number): boolean {
      return (
        db
          .update(i)
          .set({ openedPhase: phase, updatedAt: now })
          .where(and(eq(i.id, id), eq(i.openedPhase, phase - 1)))
          .run().changes === 1
      );
    },
    delete(id: string): void {
      db.delete(i).where(eq(i.id, id)).run();
    },
    /** Which initiative a task belongs to, if any. */
    initiativeOfTask(taskId: string): string | undefined {
      return db.select({ id: it.initiativeId }).from(it).where(eq(it.taskId, taskId)).get()?.id;
    },

    items(initiativeId: string): InitiativeItem[] {
      return db
        .select()
        .from(it)
        .where(eq(it.initiativeId, initiativeId))
        .orderBy(asc(it.phase), asc(it.ordinal))
        .all()
        .map(toItem);
    },
    insertItem(row: Omit<ItemRow, 'taskId' | 'startError' | 'mergeConfirmedAt' | 'droppedAt' | 'dropReason'>): void {
      db.insert(it).values(row).run();
    },
    updateItem(
      id: string,
      fields: Partial<Omit<ItemRow, 'id' | 'initiativeId' | 'createdAt' | 'startError'>> & {
        startError?: ErrorInfo | null;
      },
    ): void {
      const { startError, ...rest } = fields;
      db.update(it)
        .set({
          ...rest,
          ...(startError === undefined ? {} : { startError: startError === null ? null : JSON.stringify(startError) }),
        })
        .where(eq(it.id, id))
        .run();
    },
    /**
     * Gives the work package its new task unless something changed while the start was preparing: another start
     * linked a task first (the current task must still be the one this start read), or the user dropped it (34 §14).
     */
    claimItem(id: string, expectedTaskId: string | null, taskId: string, now: number): boolean {
      return (
        db
          .update(it)
          .set({ taskId, startError: null, mergeConfirmedAt: null, updatedAt: now })
          .where(
            and(
              eq(it.id, id),
              isNull(it.droppedAt),
              expectedTaskId === null ? isNull(it.taskId) : eq(it.taskId, expectedTaskId),
            ),
          )
          .run().changes === 1
      );
    },
    deleteItem(id: string): void {
      db.delete(it).where(eq(it.id, id)).run();
    },

    runs(initiativeId: string): InitiativeRun[] {
      return db
        .select()
        .from(initiativeRunsTable)
        .where(eq(initiativeRunsTable.initiativeId, initiativeId))
        .orderBy(asc(initiativeRunsTable.seq))
        .all();
    },
    runOfAttempt(attemptId: string): InitiativeRun | undefined {
      return db.select().from(initiativeRunsTable).where(eq(initiativeRunsTable.attemptId, attemptId)).get();
    },
    insertRun(run: InitiativeRun): void {
      db.insert(initiativeRunsTable).values(run).run();
    },
    /** The attempts of every run of these initiatives, to delete with them. */
    runAttemptIds(initiativeIds: readonly string[]): string[] {
      if (initiativeIds.length === 0) return [];
      return db
        .select({ attemptId: initiativeRunsTable.attemptId })
        .from(initiativeRunsTable)
        .where(inArray(initiativeRunsTable.initiativeId, [...initiativeIds]))
        .all()
        .map((r) => r.attemptId);
    },

    templates(): InitiativeTemplate[] {
      return db
        .select()
        .from(tpl)
        .orderBy(asc(tpl.position), asc(tpl.key))
        .all()
        .map(({ position: _position, createdAt: _c, updatedAt: _u, ...row }) => ({
          ...row,
          phases: json(phasesSchema, row.phases),
          items: json(z.array(initiativeItemSpecSchema), row.items),
        }));
    },
    upsertTemplate(template: InitiativeTemplate, position: number, now: number): void {
      const values = {
        kind: template.kind,
        position,
        name: template.name,
        description: template.description,
        phases: JSON.stringify(template.phases),
        items: JSON.stringify(template.items),
      };
      db.insert(tpl)
        .values({ id: template.id, key: template.key, ...values, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: tpl.key, set: { ...values, updatedAt: now } })
        .run();
    },
    deleteTemplate(key: string): void {
      db.delete(tpl).where(eq(tpl.key, key)).run();
    },
  };
}
