import {
  AppError,
  type CheckResult,
  checkResultSchema,
  ErrorCode,
  type NodeAcceptance,
  type NodeResult,
  type NodeStatus,
  nodeAcceptanceSchema,
  nodeResultSchema,
} from '@aw/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { rolesTable } from '../roles/index.ts';
import { nodesTable } from './nodes.table.ts';

type NodeRow = typeof nodesTable.$inferSelect;

/** A node with its JSON columns parsed and its role's key and name. */
export type Node = Omit<NodeRow, 'dependsOn' | 'acceptance' | 'result' | 'checkResults'> & {
  dependsOn: string[];
  acceptance: NodeAcceptance;
  result: NodeResult | null;
  checkResults: CheckResult[] | null;
  roleKey: string;
  roleName: string;
};

export type NewNode = Omit<NodeRow, 'dependsOn' | 'acceptance' | 'result' | 'checkResults'> & {
  dependsOn: string[];
  acceptance: NodeAcceptance;
};

/** What a plan version defines about a node; a plan adjustment rewrites it for nodes that have not started. */
export type NodeDefinition = Pick<NodeRow, 'planId' | 'title' | 'roleId' | 'instructions' | 'kind' | 'position'> & {
  dependsOn: string[];
  acceptance: NodeAcceptance;
};

/** Columns a transition may change together with the status. */
export type NodeChanges = Partial<
  Pick<NodeRow, 'attemptCount' | 'retryFeedback' | 'commitSha' | 'startedAt' | 'finishedAt'> & {
    result: NodeResult;
    checkResults: CheckResult[];
  }
>;

const keysSchema = z.array(z.string());

// JSON columns: parsed at the boundary (06 §9).
function toNode(row: { nodes: NodeRow; roleKey: string; roleName: string }): Node {
  const { nodes: n, roleKey, roleName } = row;
  return {
    ...n,
    dependsOn: keysSchema.parse(JSON.parse(n.dependsOn)),
    acceptance: nodeAcceptanceSchema.parse(JSON.parse(n.acceptance)),
    result: n.result === null ? null : nodeResultSchema.parse(JSON.parse(n.result)),
    checkResults: n.checkResults === null ? null : z.array(checkResultSchema).parse(JSON.parse(n.checkResults)),
    roleKey,
    roleName,
  };
}

function serialize(changes: NodeChanges) {
  const { result, checkResults, ...rest } = changes;
  return {
    ...rest,
    ...(result === undefined ? {} : { result: JSON.stringify(result) }),
    ...(checkResults === undefined ? {} : { checkResults: JSON.stringify(checkResults) }),
  };
}

export function createNodesRepo(db: DbExecutor) {
  const t = nodesTable;
  const select = () =>
    db
      .select({ nodes: t, roleKey: rolesTable.key, roleName: rolesTable.name })
      .from(t)
      .innerJoin(rolesTable, eq(rolesTable.id, t.roleId));

  return {
    insert(node: NewNode): void {
      db.insert(t)
        .values({ ...node, dependsOn: JSON.stringify(node.dependsOn), acceptance: JSON.stringify(node.acceptance) })
        .run();
    },
    find(id: string): Node | undefined {
      const row = select().where(eq(t.id, id)).get();
      return row === undefined ? undefined : toNode(row);
    },
    findByKey(taskId: string, key: string): Node | undefined {
      const row = select()
        .where(and(eq(t.taskId, taskId), eq(t.key, key)))
        .get();
      return row === undefined ? undefined : toNode(row);
    },
    /** Whether any node is assigned the role (a role in use cannot be deleted). */
    hasRole(roleId: string): boolean {
      return db.select({ id: t.id }).from(t).where(eq(t.roleId, roleId)).get() !== undefined;
    },
    /** By position. */
    listByTask(taskId: string): Node[] {
      return select().where(eq(t.taskId, taskId)).orderBy(asc(t.position)).all().map(toNode);
    },
    listByStatus(statuses: readonly NodeStatus[]): Node[] {
      return select().where(inArray(t.status, statuses)).orderBy(asc(t.position)).all().map(toNode);
    },
    /** Nodes of several tasks at once (the scheduler's snapshot). */
    listByTasks(taskIds: readonly string[]): Node[] {
      if (taskIds.length === 0) return [];
      return select().where(inArray(t.taskId, taskIds)).orderBy(asc(t.position)).all().map(toNode);
    },
    redefine(id: string, definition: NodeDefinition & { updatedAt: number }): void {
      db.update(t)
        .set({
          ...definition,
          dependsOn: JSON.stringify(definition.dependsOn),
          acceptance: JSON.stringify(definition.acceptance),
        })
        .where(eq(t.id, id))
        .run();
    },
    /** A user's change to a step's checks (D115); not part of the state machine. */
    setAcceptance(id: string, acceptance: NodeAcceptance, updatedAt: number): void {
      db.update(t)
        .set({ acceptance: JSON.stringify(acceptance), updatedAt })
        .where(eq(t.id, id))
        .run();
    },
    setPosition(id: string, position: number): void {
      db.update(t).set({ position }).where(eq(t.id, id)).run();
    },
    delete(id: string): void {
      db.delete(t).where(eq(t.id, id)).run();
    },
    update(id: string, changes: NodeChanges & { updatedAt: number }): void {
      db.update(t).set(serialize(changes)).where(eq(t.id, id)).run();
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(id: string, from: NodeStatus, to: NodeStatus, changes: NodeChanges & { updatedAt: number }): void {
      const result = db
        .update(t)
        .set({ status: to, ...serialize(changes) })
        .where(and(eq(t.id, id), eq(t.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `node ${id} is no longer ${from}`, {
          entity: 'node',
          from,
          to,
        });
      }
    },
  };
}
