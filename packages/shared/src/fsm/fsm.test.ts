import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../errors/codes.ts';
import { isTerminalState, listTransitions, type Machine, transition } from './define.ts';
import { MACHINES } from './index.ts';
import { toMermaid } from './mermaid.ts';

const invalid = { code: ErrorCode.StateTransitionInvalid };

describe('transition', () => {
  const { task } = MACHINES;

  it('单目标事件无需给出 to', () => {
    expect(transition(task, 'draft', 'start')).toBe('preparing');
  });

  it('多目标事件按调用方给出的 to 转换', () => {
    expect(transition(task, 'preparing', 'workspace_ready', 'plan_review')).toBe('plan_review');
  });

  it('多目标事件缺少 to 时拒绝', () => {
    expect(() => transition(task, 'preparing', 'workspace_ready')).toThrow(expect.objectContaining(invalid));
  });

  it('to 不在目标列表内时拒绝', () => {
    expect(() => transition(task, 'preparing', 'workspace_ready', 'review')).toThrow(expect.objectContaining(invalid));
  });

  it('非法转换的 details 含 entity、from、event', () => {
    expect(() => transition(task, 'completed', 'cancel')).toThrow(
      expect.objectContaining({ ...invalid, details: { entity: 'task', from: 'completed', event: 'cancel' } }),
    );
  });
});

// Representative illegal transitions per machine, taken from docs/09.
const CASES: Array<{ name: string; machine: Machine<string, string>; illegal: Array<[string, string]> }> = [
  {
    name: 'task',
    machine: MACHINES.task,
    illegal: [
      ['draft', 'plan_confirmed'],
      ['running', 'deliver'],
      ['merging', 'cancel'],
      ['paused', 'all_nodes_finished'],
      ['cancelled', 'retry'],
    ],
  },
  {
    name: 'node',
    machine: MACHINES.node,
    illegal: [
      ['pending', 'dispatch'],
      ['done', 'retry'],
      ['waiting_input', 'result_submitted'],
      ['skipped', 'cancel'],
    ],
  },
  {
    name: 'attempt',
    machine: MACHINES.attempt,
    illegal: [
      ['starting', 'submitted'],
      ['succeeded', 'abort'],
      ['interrupted', 'session_started'],
    ],
  },
  {
    name: 'plan',
    machine: MACHINES.plan,
    illegal: [
      ['superseded', 'confirm'],
      ['confirmed', 'confirm'],
    ],
  },
  {
    name: 'worktree',
    machine: MACHINES.worktree,
    illegal: [
      ['creating', 'remove'],
      ['removed', 'remove'],
    ],
  },
  {
    name: 'delivery',
    machine: MACHINES.delivery,
    illegal: [
      ['conflict', 'succeeded'],
      ['succeeded', 'failed'],
    ],
  },
  {
    name: 'inbox',
    machine: MACHINES.inbox,
    illegal: [
      ['resolved', 'dismiss'],
      ['dismissed', 'resolve'],
    ],
  },
  {
    name: 'runtime',
    machine: MACHINES.runtime,
    illegal: [
      ['not_installed', 'start'],
      ['ready', 'start'],
      ['stopped', 'listening'],
    ],
  },
];

it('每个状态机都有用例', () => {
  expect(CASES.map((c) => c.name)).toEqual(Object.keys(MACHINES));
});

describe.each(CASES)('$name 状态机', ({ machine, illegal }) => {
  it('表中每个合法转换都被接受', () => {
    for (const [from, event, to] of listTransitions(machine)) {
      expect(transition(machine, from, event, to)).toBe(to);
    }
  });

  it('代表性的非法转换被拒绝', () => {
    for (const [from, event] of illegal) {
      expect(() => transition(machine, from, event)).toThrow(expect.objectContaining(invalid));
    }
  });

  it('终态不接受任何事件', () => {
    for (const state of machine.states.filter((s) => isTerminalState(machine, s))) {
      for (const event of machine.events) expect(() => transition(machine, state, event)).toThrow();
    }
  });

  it('Mermaid 输出包含每个转换', () => {
    const mermaid = toMermaid(machine);
    for (const [from, event, to] of listTransitions(machine)) expect(mermaid).toContain(`${from} --> ${to}: ${event}`);
  });
});
