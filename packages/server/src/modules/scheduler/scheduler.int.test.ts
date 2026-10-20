import { AttemptStatus, NodeStatus, ServerEventType, updateSettingsOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, finalVerify, planArgs } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('调度器', () => {
  it('3 个任务各有两个并行节点：全局与每任务的并发上限都生效，所有任务完成', async () => {
    await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 2, 'scheduler.maxConcurrentNodesPerTask': 1 });
    const { project } = await addProject(t, { checkCommand: null });
    for (let i = 1; i <= 3; i++) {
      t.fake.enqueue(
        script().callTool('submit_plan', planArgs([{ key: 'a' }, { key: 'b' }, finalVerify(['a', 'b'])])),
        {
          agent: 'aw-planner',
        },
      );
      for (const step of ['a', 'b', '整体验证']) {
        t.fake.enqueue(script().callTool('submit_result', { summary: step }), { title: `T-${i} · ${step}` });
      }
      t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    }

    const active = new Set<string>();
    const working = new Map<string, Set<string>>();
    let peak = 0;
    let peakPerTask = 0;
    t.app.events.subscribe((event) => {
      if (event.type === ServerEventType.AttemptUpdated) {
        const { attempt } = event.data;
        if (attempt.status === AttemptStatus.Starting || attempt.status === AttemptStatus.Running)
          active.add(attempt.id);
        else active.delete(attempt.id);
        peak = Math.max(peak, active.size);
      }
      if (event.type === ServerEventType.NodeUpdated) {
        const nodes = working.get(event.data.taskId) ?? new Set<string>();
        const busy: readonly NodeStatus[] = [NodeStatus.Running, NodeStatus.WaitingInput, NodeStatus.Verifying];
        if (busy.includes(event.data.node.status)) nodes.add(event.data.node.id);
        else nodes.delete(event.data.node.id);
        working.set(event.data.taskId, nodes);
        peakPerTask = Math.max(peakPerTask, nodes.size);
      }
    });
    let reviewed = 0;
    const allReviewed = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (d) => d.status === 'review' && ++reviewed === 3,
      15_000,
    );
    for (let i = 0; i < 3; i++)
      await createTask(t, { projectId: project.id, workflow: 'feature', requirement: `Task ${i}` });
    await allReviewed;

    expect(peak).toBe(2);
    expect(peakPerTask).toBe(1);
  });
});
