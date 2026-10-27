import { type CompanionNotice, type InboxItemDTO, InboxKind, InboxStatus, TaskStatus } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { createCompanionNotifications } from './companion-notifications.ts';

const task = (status: TaskStatus, updatedAt: number, id = 'one') => ({
  id,
  key: 'TASK-1',
  title: '交付报告',
  status,
  updatedAt,
});
const question: InboxItemDTO = {
  id: 'question',
  kind: InboxKind.Question,
  status: InboxStatus.Open,
  title: '采用哪个方案？',
  taskId: 'one',
  nodeId: null,
  attemptId: null,
  createdAt: 1,
  resolvedAt: null,
  payload: { question: '采用哪个方案？', blocking: true },
  response: null,
};

describe('助手按真实业务状态提醒', () => {
  it('历史快照静默；进度和重放不重复；重新执行后可再次庆祝，多个任务保留顺序', () => {
    const notices: Omit<CompanionNotice, 'system'>[] = [];
    const tracker = createCompanionNotifications(
      (notice) => notices.push(notice),
      () => {},
      new Set(),
    );
    tracker.snapshot([task(TaskStatus.Completed, 1), task(TaskStatus.Running, 1, 'two')], [question]);
    expect(notices).toEqual([]);
    tracker.task(task(TaskStatus.Review, 2, 'two'));
    tracker.task(task(TaskStatus.Review, 3, 'two'));
    tracker.task(task(TaskStatus.Review, 2, 'two'));
    tracker.task(task(TaskStatus.Running, 4, 'two'));
    tracker.task(task(TaskStatus.Review, 5, 'two'));
    tracker.task(task(TaskStatus.Completed, 6, 'two'));
    tracker.task(task(TaskStatus.Failed, 7));
    expect(notices.map((n) => n.title)).toEqual([
      '已经准备好，等你检查',
      '已经准备好，等你检查',
      '任务完成啦',
      '任务遇到问题，需要你看看',
    ]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(4);
    expect(notices[2]).toMatchObject({ mood: 'success', path: '/tasks/two' });
  });
  it('重连对齐漏掉的最终状态；新问题提醒一次；初始加载时的实时完成不会被快照吞掉', () => {
    const notices: Omit<CompanionNotice, 'system'>[] = [];
    const tracker = createCompanionNotifications(
      (notice) => notices.push(notice),
      () => {},
      new Set(),
    );
    tracker.task(task(TaskStatus.Review, 2));
    tracker.snapshot([task(TaskStatus.Review, 2)], []);
    tracker.snapshot([task(TaskStatus.Completed, 3)], [question]);
    tracker.item(question);
    tracker.snapshot([task(TaskStatus.Completed, 3)], [question]);
    expect(notices.map((n) => n.mood)).toEqual(['success', 'success', 'waiting']);
  });
  it('通知说的事不再成立就撤回：待处理项已处理（包括断线期间处理的），任务进入下一个状态', () => {
    const notices: string[] = [];
    const withdrawn: string[] = [];
    const tracker = createCompanionNotifications(
      (notice) => notices.push(notice.id),
      (id) => withdrawn.push(id),
      new Set(),
    );
    const permission: InboxItemDTO = { ...question, id: 'permission' };
    tracker.snapshot([task(TaskStatus.Running, 1)], []);
    tracker.item(question);
    tracker.item(permission);
    tracker.item({ ...question, status: InboxStatus.Resolved });
    tracker.item({ ...question, status: InboxStatus.Resolved });
    tracker.snapshot([task(TaskStatus.Running, 1)], [{ ...permission, status: InboxStatus.Resolved }]);
    expect(withdrawn).toEqual(['inbox:question', 'inbox:permission']);

    tracker.task(task(TaskStatus.Review, 2));
    tracker.task(task(TaskStatus.Review, 3));
    tracker.task(task(TaskStatus.Completed, 4));
    expect(withdrawn.slice(2)).toEqual([notices[2]]);
    expect(notices).toHaveLength(4);
  });
  it('另一个窗口已处理的提醒，晚到的事件和重连快照都不再提醒', () => {
    const notices: string[] = [];
    const dismissed = new Set(['inbox:question', 'task:one:review:2']);
    const tracker = createCompanionNotifications(
      (notice) => notices.push(notice.id),
      () => {},
      dismissed,
    );
    tracker.snapshot([task(TaskStatus.Running, 1)], []);
    tracker.item(question);
    tracker.task(task(TaskStatus.Review, 2));
    tracker.snapshot([task(TaskStatus.Review, 2)], [question]);
    expect(notices).toEqual([]);
    tracker.task(task(TaskStatus.Completed, 3));
    expect(notices).toEqual(['task:one:completed:3']);
  });
});
