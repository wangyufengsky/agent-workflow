import { describe, expect, it } from 'vitest';
import { createBatchRequestSchema } from '../contracts/api/batches.ts';
import { DeliveryStatus } from '../enums/git.ts';
import { TaskDisplayGroup, TaskStatus } from '../enums/task.ts';
import { batchCounts, isBatchDeliverable, renderBatchRequirement } from './batch.ts';

describe('批量任务（20）', () => {
  it('每一处 {{target}} 都替换为目标原文', () => {
    expect(renderBatchRequirement('为 {{target}} 补单测\n只改 {{target}} 的测试', 'src/a/')).toBe(
      '为 src/a/ 补单测\n只改 src/a/ 的测试',
    );
  });

  it('按显示顺序汇总有任务的显示状态', () => {
    const { Completed, Running, NeedsAttention } = TaskDisplayGroup;
    expect(batchCounts([Completed, Running, Completed, NeedsAttention])).toEqual([
      { group: Running, count: 1 },
      { group: NeedsAttention, count: 1 },
      { group: Completed, count: 2 },
    ]);
  });

  it('待合并：在 review 且本轮交付不是冲突', () => {
    const item = (status: TaskStatus, delivery: DeliveryStatus | null) => ({
      task: { status },
      lastDelivery: delivery === null ? null : { status: delivery },
    });
    expect(isBatchDeliverable(item(TaskStatus.Review, null))).toBe(true);
    expect(isBatchDeliverable(item(TaskStatus.Review, DeliveryStatus.Failed))).toBe(true);
    expect(isBatchDeliverable(item(TaskStatus.Review, DeliveryStatus.Conflict))).toBe(false);
    expect(isBatchDeliverable(item(TaskStatus.Running, null))).toBe(false);
  });

  describe('创建请求的校验', () => {
    const valid = { projectId: 'p', workflowId: 'w', requirementTemplate: '为 {{target}} 补单测', targets: ['a', 'b'] };
    const issues = (input: Record<string, unknown>) =>
      createBatchRequestSchema.safeParse({ ...valid, ...input }).error?.issues.map((i) => i.path.join('.'));

    it('目标去掉首尾空白后通过', () => {
      expect(createBatchRequestSchema.parse({ ...valid, targets: [' a ', 'b'] }).targets).toEqual(['a', 'b']);
    });
    it('模板没有占位符', () => expect(issues({ requirementTemplate: '补单测' })).toEqual(['requirementTemplate']));
    it('目标重复', () => expect(issues({ targets: ['a', ' a'] })).toEqual(['targets']));
    it('目标含换行', () => expect(issues({ targets: ['a\nb'] })).toEqual(['targets.0']));
    it('替换后的需求超长', () =>
      expect(issues({ requirementTemplate: '{{target}}'.repeat(100), targets: ['a', 'x'.repeat(201)] })).toEqual([
        'targets.1',
      ]));
  });
});
