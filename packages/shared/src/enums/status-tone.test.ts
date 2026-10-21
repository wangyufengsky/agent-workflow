import { describe, expect, it } from 'vitest';
import { KnowledgeTurnStatus } from './knowledge.ts';
import { STATUS_TONE } from './status-tone.ts';
import { RuntimeStatus } from './system.ts';
import {
  ATTEMPT_STATUSES,
  NODE_STATUSES,
  TASK_DISPLAY_GROUPS,
  TASK_STATUSES,
  TaskDisplayGroup,
  TaskStatus,
} from './task.ts';
import { resolveTaskDisplayGroup } from './task-display.ts';
import { STATUS_TONES } from './ui.ts';

describe('STATUS_TONE', () => {
  it.each([
    ['task', TASK_STATUSES, STATUS_TONE.task],
    ['node', NODE_STATUSES, STATUS_TONE.node],
    ['attempt', ATTEMPT_STATUSES, STATUS_TONE.attempt],
    ['knowledgeTurn', Object.values(KnowledgeTurnStatus), STATUS_TONE.knowledgeTurn],
    ['runtime', Object.values(RuntimeStatus), STATUS_TONE.runtime],
    ['taskDisplay', TASK_DISPLAY_GROUPS, STATUS_TONE.taskDisplay],
  ] as const)('%s 的每个状态都映射到一个合法语气', (_name, statuses, map) => {
    const tones: Record<string, string> = map;
    expect(Object.keys(tones).sort()).toEqual([...statuses].sort());
    for (const status of statuses) expect(STATUS_TONES).toContain(tones[status]);
  });
});

describe('resolveTaskDisplayGroup', () => {
  it('有待处理的提问 / 权限 / 验收时非终态任务显示为需要你处理', () => {
    expect(resolveTaskDisplayGroup(TaskStatus.Running, true)).toBe(TaskDisplayGroup.NeedsAttention);
    expect(resolveTaskDisplayGroup(TaskStatus.Failed, true)).toBe(TaskDisplayGroup.NeedsAttention);
  });

  it('终态任务不被待处理条目覆盖', () => {
    expect(resolveTaskDisplayGroup(TaskStatus.Completed, true)).toBe(TaskDisplayGroup.Completed);
    expect(resolveTaskDisplayGroup(TaskStatus.Cancelled, true)).toBe(TaskDisplayGroup.Cancelled);
  });

  it('没有待处理条目时按状态映射', () => {
    expect(resolveTaskDisplayGroup(TaskStatus.Planning, false)).toBe(TaskDisplayGroup.Preparing);
  });
});
