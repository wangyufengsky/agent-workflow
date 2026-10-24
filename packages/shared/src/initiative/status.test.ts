import { describe, expect, it } from 'vitest';
import { DeliveryStatus, DeliveryStrategy } from '../enums/git.ts';
import { InitiativeItemStatus, InitiativeStatus } from '../enums/initiative.ts';
import { TaskStatus } from '../enums/task.ts';
import { WorkflowDeliverable } from '../enums/workflow.ts';
import { type InitiativeItemFacts, initiativeItemStatusOf, initiativeStatusOf } from './status.ts';

const facts = (over: Partial<InitiativeItemFacts> = {}): InitiativeItemFacts => ({
  droppedAt: null,
  mergeConfirmedAt: null,
  task: null,
  deliverable: WorkflowDeliverable.CodeChanges,
  lastDelivery: null,
  ...over,
});
const completed = (strategy: DeliveryStrategy, targetBranch = 'main') =>
  facts({
    task: { status: TaskStatus.Completed },
    lastDelivery: { status: DeliveryStatus.Succeeded, strategy, targetBranch },
  });
const open = { baseBranch: 'main', phaseOpened: true, depsDone: true };
const status = (f: InitiativeItemFacts, where = open) => initiativeItemStatusOf(f, where);

describe('工作包的显示状态（34 §6.1）', () => {
  it('本地合并进基础分支、报告完成、PR 经用户确认已合入、放弃，才算完成', () => {
    expect(status(completed(DeliveryStrategy.Squash))).toBe(InitiativeItemStatus.Satisfied);
    expect(status(completed(DeliveryStrategy.ReportOnly))).toBe(InitiativeItemStatus.Ready);
    expect(status({ ...completed(DeliveryStrategy.ReportOnly), deliverable: WorkflowDeliverable.Report })).toBe(
      InitiativeItemStatus.Satisfied,
    );
    expect(status(completed(DeliveryStrategy.PullRequest))).toBe(InitiativeItemStatus.PrOpen);
    expect(status({ ...completed(DeliveryStrategy.PullRequest), mergeConfirmedAt: 1 })).toBe(
      InitiativeItemStatus.Satisfied,
    );
    expect(status(facts({ droppedAt: 1 }))).toBe(InitiativeItemStatus.Dropped);
  });

  it('合并到别的分支或任务被取消时可以重新开始；进行中的任务（含失败）显示任务本身', () => {
    expect(status(completed(DeliveryStrategy.Merge, 'develop'))).toBe(InitiativeItemStatus.Ready);
    expect(status(facts({ task: { status: TaskStatus.Cancelled } }))).toBe(InitiativeItemStatus.Ready);
    expect(status(facts({ task: { status: TaskStatus.Failed } }))).toBe(InitiativeItemStatus.InTask);
    expect(status(facts({ task: { status: TaskStatus.Review } }))).toBe(InitiativeItemStatus.InTask);
  });

  it('阶段未开启、依赖未完成时等待', () => {
    expect(status(facts(), { ...open, phaseOpened: false })).toBe(InitiativeItemStatus.PhaseClosed);
    expect(status(facts(), { ...open, depsDone: false })).toBe(InitiativeItemStatus.Waiting);
  });
});

describe('需求计划的显示状态（34 §6.2）', () => {
  const base = { run: null, breakdownRev: 1, confirmedRev: 1, openedPhase: 1, phaseCount: 2 };
  it('草稿待确认、阶段完成、全部完成', () => {
    const items = [
      { phase: 1, done: true },
      { phase: 2, done: false },
    ];
    expect(initiativeStatusOf({ ...base, confirmedRev: 0, openedPhase: 0, items })).toBe(InitiativeStatus.DraftReady);
    expect(initiativeStatusOf({ ...base, items })).toBe(InitiativeStatus.PhaseDone);
    expect(initiativeStatusOf({ ...base, openedPhase: 2, items })).toBe(InitiativeStatus.InProgress);
    expect(initiativeStatusOf({ ...base, openedPhase: 2, items: items.map((i) => ({ ...i, done: true })) })).toBe(
      InitiativeStatus.Done,
    );
  });

  it('拆解或细化进行中优先；第一次拆解没留下工作包就是失败', () => {
    const items = [{ phase: 1, done: false }];
    expect(initiativeStatusOf({ ...base, run: { active: true }, items })).toBe(InitiativeStatus.BreakingDown);
    expect(initiativeStatusOf({ ...base, run: { active: true }, breakdownRev: 0, items: [] })).toBe(
      InitiativeStatus.BreakingDown,
    );
    expect(initiativeStatusOf({ ...base, run: { active: false }, breakdownRev: 0, confirmedRev: 0, items: [] })).toBe(
      InitiativeStatus.BreakdownFailed,
    );
  });
});
