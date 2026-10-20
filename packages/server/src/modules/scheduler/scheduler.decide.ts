import { NodeStatus, TaskStatus } from '@aw/shared';

export type SchedulerSnapshot = {
  maxConcurrentAttempts: number;
  maxConcurrentNodesPerTask: number;
  /** opencode can take new sessions. */
  runtimeReady: boolean;
  /** Tasks in planning, running or paused, oldest first; nodes by position. */
  tasks: ReadonlyArray<{
    id: string;
    status: TaskStatus;
    /** A planning attempt is starting or running. */
    planning: boolean;
    nodes: ReadonlyArray<{ id: string; key: string; status: NodeStatus; dependsOn: readonly string[] }>;
  }>;
};

export type SchedulerDecision = {
  /** Pending nodes whose dependencies are all done or skipped (`deps_met`). */
  depsMet: string[];
  /** Ready nodes to start, within the limits. */
  dispatch: Array<{ taskId: string; nodeId: string }>;
  /** Planning tasks without a planning attempt (new, retried, or interrupted with the runtime). */
  startPlanning: string[];
  /** Running tasks whose nodes are all done or skipped (`all_nodes_finished`). */
  finished: string[];
  /** Running tasks with a failed node and nothing else working (`fail`). */
  failed: string[];
};

const FINISHED: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped];
/** Nodes with a session (or a check) at work: they take a slot of the global limit. */
const BUSY: readonly NodeStatus[] = [NodeStatus.Running, NodeStatus.Verifying];
/** Nodes the task is still waiting on before it may fail (09 §2 `fail`). */
const WORKING: readonly NodeStatus[] = [NodeStatus.Running, NodeStatus.Verifying, NodeStatus.WaitingInput];

/**
 * What the scheduler does next (09 §2, 03 §8): dependency release, dispatch within the global and per-task limits
 * (oldest task first, nodes by position), planning starts, and the task events derived from node states. Once a task
 * has a failed node nothing more of it is dispatched.
 */
export function decide(snapshot: SchedulerSnapshot): SchedulerDecision {
  const decision: SchedulerDecision = { depsMet: [], dispatch: [], startPlanning: [], finished: [], failed: [] };
  let busy = snapshot.tasks.reduce(
    (sum, task) => sum + (task.planning ? 1 : 0) + task.nodes.filter((n) => BUSY.includes(n.status)).length,
    0,
  );
  const hasRoom = () => snapshot.runtimeReady && busy < snapshot.maxConcurrentAttempts;

  for (const task of snapshot.tasks) {
    if (task.status === TaskStatus.Planning) {
      if (!task.planning && hasRoom()) {
        decision.startPlanning.push(task.id);
        busy += 1;
      }
      continue;
    }

    const statusOf = new Map(task.nodes.map((n) => [n.key, n.status]));
    const nodes = task.nodes.map((node) => {
      const released =
        node.status === NodeStatus.Pending &&
        node.dependsOn.every((key) => FINISHED.includes(statusOf.get(key) ?? NodeStatus.Pending));
      if (!released) return node;
      decision.depsMet.push(node.id);
      return { ...node, status: NodeStatus.Ready };
    });
    if (task.status !== TaskStatus.Running) continue;

    if (nodes.every((n) => FINISHED.includes(n.status))) {
      decision.finished.push(task.id);
      continue;
    }
    if (nodes.some((n) => n.status === NodeStatus.Failed)) {
      if (!nodes.some((n) => WORKING.includes(n.status))) decision.failed.push(task.id);
      continue;
    }
    let taskBusy = nodes.filter((n) => WORKING.includes(n.status)).length;
    for (const node of nodes) {
      if (node.status !== NodeStatus.Ready) continue;
      if (!hasRoom() || taskBusy >= snapshot.maxConcurrentNodesPerTask) break;
      decision.dispatch.push({ taskId: task.id, nodeId: node.id });
      taskBusy += 1;
      busy += 1;
    }
  }
  return decision;
}
