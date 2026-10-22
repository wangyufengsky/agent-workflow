import { randomUUID } from 'node:crypto';
import {
  AppError,
  EDITABLE_NODE_STATUSES,
  ErrorCode,
  isTerminalState,
  type NodeAcceptance,
  type NodeDetailDTO,
  NodeEvent,
  NodeKind,
  type NodeOutput,
  NodeStatus,
  type NodeSummaryDTO,
  nodeMachine,
  type PlanNodeSpec,
  ServerEventType,
  TaskEventEntity,
  transition,
} from '@aw/shared';
import { recordTaskEvent } from '../timeline/index.ts';
import { createNodesRepo, type Node, type NodeChanges } from './nodes.repo.ts';
import { resolveAcceptance } from './nodes.rules.ts';
import { createNodeRunner } from './nodes.run.ts';
import type { MaterializeInput, NodesServiceDeps } from './nodes.types.ts';

export type { MaterializeInput, NodeRunContext, NodesServiceDeps } from './nodes.types.ts';

function toSummary(node: Node): NodeSummaryDTO {
  return {
    id: node.id,
    key: node.key,
    title: node.title,
    roleKey: node.roleKey,
    roleName: node.roleName,
    kind: node.kind,
    status: node.status,
    dependsOn: node.dependsOn,
    attemptCount: node.attemptCount,
    resultSummary: node.result?.summary ?? null,
    position: node.position,
    startedAt: node.startedAt,
    finishedAt: node.finishedAt,
  };
}

/** Nodes of the confirmed plan (10 §nodes) and their state machine (09 §3); execution is in `nodes.run.ts`. */
export function createNodesService(deps: NodesServiceDeps) {
  const { db, unit, clock, log, inbox, roles } = deps;
  const repo = createNodesRepo(db);

  function get(id: string): Node {
    const node = repo.find(id);
    if (node === undefined) throw new AppError(ErrorCode.NodeNotFound, `Node ${id} not found`, { id });
    return node;
  }

  function publish(node: Node): void {
    unit.publish({ type: ServerEventType.NodeUpdated, data: { taskId: node.taskId, node: toSummary(node) } });
  }

  /** Applies a state-machine event with its task event; a node that ends takes its open inbox items with it. */
  function move(node: Node, event: NodeEvent, to?: NodeStatus, changes: NodeChanges = {}): Node {
    const target = transition(nodeMachine, node.status, event, to);
    const now = clock.now();
    const updated = unit.transact(() => {
      repo.updateStatus(node.id, node.status, target, { ...changes, updatedAt: now });
      recordTaskEvent(db, {
        taskId: node.taskId,
        entity: TaskEventEntity.Node,
        entityId: node.id,
        type: event,
        fromStatus: node.status,
        toStatus: target,
        createdAt: now,
      });
      if (isTerminalState(nodeMachine, target)) inbox.dismissOpen({ nodeId: node.id });
      return get(node.id);
    });
    log.info({ taskId: node.taskId, nodeId: node.id, from: node.status, to: target, event }, 'node transition');
    publish(updated);
    return updated;
  }

  const runner = createNodeRunner(deps, { repo, get, move });

  /** The node a plan step defines, as stored (acceptance resolved for the project and the task's checkpoints). */
  function definitionOf(input: Omit<MaterializeInput, 'graph'>, spec: PlanNodeSpec, position: number) {
    return {
      planId: input.planId,
      title: spec.title,
      roleId: roles.getByKey(spec.roleKey).id,
      instructions: spec.instructions,
      dependsOn: spec.dependsOn,
      acceptance: resolveAcceptance(
        spec.acceptance ?? input.defaultAcceptance,
        input.checkCommand,
        input.acceptEachNode,
      ),
      kind: spec.kind ?? NodeKind.Normal,
      position,
    };
  }

  function insert(input: Omit<MaterializeInput, 'graph'>, spec: PlanNodeSpec, position: number): Node {
    const id = randomUUID();
    const now = clock.now();
    repo.insert({
      id,
      taskId: input.taskId,
      key: spec.key,
      ...definitionOf(input, spec, position),
      status: spec.dependsOn.length === 0 ? NodeStatus.Ready : NodeStatus.Pending,
      attemptCount: 0,
      retryFeedback: null,
      commitSha: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    });
    return get(id);
  }

  return {
    get,
    ...runner,

    summaries: (taskId: string): NodeSummaryDTO[] => repo.listByTask(taskId).map(toSummary),
    /** All nodes of the tasks, for the scheduler. */
    listByTasks: (taskIds: readonly string[]): Node[] => repo.listByTasks(taskIds),
    listByTask: (taskId: string): Node[] => repo.listByTask(taskId),
    usesRole: (roleId: string): boolean => repo.hasRole(roleId),

    detail(taskId: string, nodeId: string): NodeDetailDTO {
      const node = get(nodeId);
      if (node.taskId !== taskId) throw new AppError(ErrorCode.NodeNotFound, `Node ${nodeId} not in task ${taskId}`);
      return {
        ...toSummary(node),
        taskId,
        instructions: node.instructions,
        acceptance: node.acceptance,
        result: node.result,
        checkResults: node.checkResults,
        retryFeedback: node.retryFeedback,
        commitSha: node.commitSha,
        attempts: deps.attempts.listByNode(nodeId),
      };
    },

    /** `get_node_output` (12 §6.2): the full result of a finished node. */
    output(taskId: string, key: string): NodeOutput {
      const node = repo.findByKey(taskId, key);
      if (node === undefined || node.status !== NodeStatus.Done || node.result === null) {
        throw new AppError(ErrorCode.McpNodeNotFound, `No finished step ${key}`, { node_key: key });
      }
      const { result } = node;
      return {
        key: node.key,
        title: node.title,
        summary: result.summary,
        changes: result.changes ?? [],
        ...(result.notes === undefined ? {} : { notes: result.notes }),
        assumptions: result.assumptions ?? [],
        checkResults: (node.checkResults ?? []).map(({ kind, passed, output }) => ({ kind, passed, output })),
      };
    },

    /** Creates the nodes of a confirmed plan: those without dependencies are ready (09 §3). */
    materialize(input: MaterializeInput): void {
      const created = unit.transact(() => input.graph.nodes.map((spec, position) => insert(input, spec, position)));
      for (const node of created) publish(node);
    },

    /**
     * Adds one node of a newer confirmed plan version to the task's existing nodes, after them (09 §2
     * `changes_requested`: the revise or conflict-resolution step).
     */
    append(input: Omit<MaterializeInput, 'graph'>, spec: PlanNodeSpec): Node {
      const node = insert(input, spec, repo.listByTask(input.taskId).length);
      publish(node);
      return node;
    },

    /**
     * Applies a newer confirmed plan version of a paused task (09 §2): steps that have not started take their new
     * definition, new steps are created and removed ones deleted; started steps only move to their new position. The
     * caller has checked that started steps are unchanged (`lockedChanges`).
     */
    rematerialize(input: MaterializeInput): void {
      const existing = new Map(repo.listByTask(input.taskId).map((n) => [n.key, n]));
      const keys = new Set(input.graph.nodes.map((n) => n.key));
      const touched = unit.transact(() => {
        for (const node of existing.values()) {
          if (keys.has(node.key)) continue;
          if (!EDITABLE_NODE_STATUSES.includes(node.status)) throw new Error(`Started node ${node.key} was removed`);
          repo.delete(node.id);
        }
        const now = clock.now();
        const nodes = input.graph.nodes.map((spec, position) => {
          const node = existing.get(spec.key);
          if (node === undefined) return insert(input, spec, position);
          if (EDITABLE_NODE_STATUSES.includes(node.status)) {
            repo.redefine(node.id, { ...definitionOf(input, spec, position), updatedAt: now });
          } else repo.setPosition(node.id, position);
          return get(node.id);
        });
        const finished = new Set(
          nodes.filter((n) => n.status === NodeStatus.Done || n.status === NodeStatus.Skipped).map((n) => n.key),
        );
        // A ready step that now depends on unfinished work waits again; the scheduler releases it (`deps_met`).
        // `move` publishes the steps it changes; the others are returned to be published here.
        return nodes.filter((n) => {
          const waits = n.status === NodeStatus.Ready && !n.dependsOn.every((key) => finished.has(key));
          if (waits) move(n, NodeEvent.DepsUnmet);
          return !waits;
        });
      });
      for (const node of touched) publish(node);
    },

    /** The task's checks changed by the user (D116): a step's acceptance, which no transition touches. */
    setAcceptance(nodeId: string, acceptance: NodeAcceptance): void {
      repo.setAcceptance(nodeId, acceptance, clock.now());
    },

    /** Pro mode (09 §3): a skipped step counts as finished for the steps depending on it. */
    skip: (nodeId: string): Node => move(get(nodeId), NodeEvent.Skip, undefined, { finishedAt: clock.now() }),

    /** `deps_met`: every dependency is done or skipped. */
    markReady: (nodeId: string): Node => move(get(nodeId), NodeEvent.DepsMet),

    /** Task cancelled: unfinished nodes are cancelled and their verifications stopped. */
    cancelAll(taskId: string): void {
      const cancelled = unit.transact(() =>
        repo
          .listByTask(taskId)
          .filter((n) => !isTerminalState(nodeMachine, n.status))
          .map((n) => move(n, NodeEvent.Cancel)),
      );
      for (const node of cancelled) runner.stopVerification(node.id);
    },
  };
}
export type NodesService = ReturnType<typeof createNodesService>;
