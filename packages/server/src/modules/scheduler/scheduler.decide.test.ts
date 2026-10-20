import { NodeStatus, type NodeStatus as Status, TaskStatus } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { decide, type SchedulerSnapshot } from './scheduler.decide.ts';

type Task = SchedulerSnapshot['tasks'][number];

const node = (key: string, status: Status, dependsOn: string[] = []) => ({ id: key, key, status, dependsOn });
const task = (id: string, nodes: Task['nodes'], status: TaskStatus = TaskStatus.Running): Task => ({
  id,
  status,
  planning: false,
  nodes: nodes.map((n) => ({ ...n, id: `${id}.${n.key}` })),
});
const snapshot = (tasks: Task[], extra: Partial<SchedulerSnapshot> = {}): SchedulerSnapshot => ({
  maxConcurrentAttempts: 4,
  maxConcurrentNodesPerTask: 2,
  runtimeReady: true,
  tasks,
  ...extra,
});
const dispatched = (s: SchedulerSnapshot) => decide(s).dispatch.map((d) => d.nodeId);

describe('调度决策', () => {
  it('依赖全部完成或跳过时释放节点，并在同一轮派发', () => {
    const s = snapshot([
      task('t', [
        node('a', NodeStatus.Done),
        node('b', NodeStatus.Skipped),
        node('c', NodeStatus.Pending, ['a', 'b']),
        node('d', NodeStatus.Pending, ['c']),
      ]),
    ]);
    expect(decide(s)).toMatchObject({ depsMet: ['t.c'], dispatch: [{ taskId: 't', nodeId: 't.c' }] });
  });

  it('每任务上限计入等待输入的节点；按位置派发', () => {
    const s = snapshot([
      task('t', [node('a', NodeStatus.WaitingInput), node('b', NodeStatus.Ready), node('c', NodeStatus.Ready)]),
    ]);
    expect(dispatched(s)).toEqual(['t.b']);
  });

  it('全局上限计入所有任务进行中的节点与规划会话，旧任务优先', () => {
    const s = snapshot(
      [
        { ...task('plan', [], TaskStatus.Planning), planning: true },
        task('old', [node('a', NodeStatus.Verifying), node('b', NodeStatus.Ready)]),
        task('new', [node('a', NodeStatus.Ready)]),
      ],
      { maxConcurrentAttempts: 3 },
    );
    expect(dispatched(s)).toEqual(['old.b']);
  });

  it('有失败节点后不再派发；仍有节点在工作时不判定失败，全部停下后判定失败', () => {
    const working = snapshot([
      task('t', [node('a', NodeStatus.Failed), node('b', NodeStatus.Running), node('c', NodeStatus.Ready)]),
    ]);
    expect(decide(working)).toMatchObject({ dispatch: [], failed: [] });
    const stopped = snapshot([task('t', [node('a', NodeStatus.Failed), node('c', NodeStatus.Ready)])]);
    expect(decide(stopped)).toMatchObject({ dispatch: [], failed: ['t'] });
  });

  it('全部节点完成或跳过时推导 all_nodes_finished', () => {
    const s = snapshot([task('t', [node('a', NodeStatus.Done), node('b', NodeStatus.Skipped)])]);
    expect(decide(s)).toMatchObject({ finished: ['t'], dispatch: [] });
  });

  it('暂停的任务只释放依赖，不派发、不推导任务事件', () => {
    const s = snapshot([
      task(
        't',
        [node('a', NodeStatus.Done), node('b', NodeStatus.Pending, ['a']), node('c', NodeStatus.Ready)],
        TaskStatus.Paused,
      ),
    ]);
    expect(decide(s)).toEqual({ depsMet: ['t.b'], dispatch: [], startPlanning: [], finished: [], failed: [] });
  });

  it('规划中且没有规划会话的任务在有空位时开始规划', () => {
    const planning = (id: string, active: boolean): Task => ({
      ...task(id, [], TaskStatus.Planning),
      planning: active,
    });
    expect(
      decide(snapshot([planning('a', false), planning('b', true), planning('c', false)], { maxConcurrentAttempts: 2 })),
    ).toMatchObject({ startPlanning: ['a'] });
  });

  it('opencode 未就绪时不派发也不开始规划', () => {
    const s = snapshot(
      [{ ...task('p', [], TaskStatus.Planning), planning: false }, task('t', [node('a', NodeStatus.Ready)])],
      { runtimeReady: false },
    );
    expect(decide(s)).toMatchObject({ dispatch: [], startPlanning: [] });
  });
});
