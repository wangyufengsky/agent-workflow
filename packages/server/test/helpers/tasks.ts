import {
  createProjectOp,
  createTaskOp,
  type InboxItemDTO,
  listWorkflowsOp,
  type NodeStatus,
  ServerEventType,
  type TaskDetailDTO,
  type TaskStatus,
  updateProjectOp,
} from '@aw/shared';
import type { TestApp } from './app.ts';
import { waitForEvent } from './events.ts';
import { createTestRepo, type TestRepo } from './git.ts';

/** A project on a fresh repository; `checkCommand` overrides the inferred one (null = none). */
export async function addProject(
  t: TestApp,
  options: { files?: Record<string, string>; checkCommand?: string | null } = {},
) {
  const repo: TestRepo = await createTestRepo({ files: options.files ?? {} });
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  if (options.checkCommand !== undefined) {
    await t.call(updateProjectOp, { id: project.id, checkCommand: options.checkCommand });
  }
  return { repo, project };
}

export async function workflowId(t: TestApp, key: string): Promise<string> {
  const workflow = (await t.call(listWorkflowsOp, {})).body.items.find((w) => w.key === key);
  if (workflow === undefined) throw new Error(`No workflow ${key}`);
  return workflow.id;
}

export async function createTask(
  t: TestApp,
  input: {
    projectId: string;
    workflow: string;
    requirement?: string;
    start?: boolean;
    checkpoints?: Record<string, boolean>;
  },
): Promise<TaskDetailDTO> {
  const res = await t.call(createTaskOp, {
    projectId: input.projectId,
    workflowId: await workflowId(t, input.workflow),
    requirement: input.requirement ?? 'Add a greeting module\nIt says hello.',
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.checkpoints === undefined ? {} : { checkpoints: input.checkpoints }),
  });
  if (res.status !== 201) throw new Error(`createTask failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Subscribe before acting (07 §4). */
export const taskReaches = (t: TestApp, status: TaskStatus, timeoutMs?: number) =>
  waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.status === status, timeoutMs);

export const nodeReaches = (t: TestApp, key: string, status: NodeStatus, timeoutMs?: number) =>
  waitForEvent(
    t.app.events,
    ServerEventType.NodeUpdated,
    (d) => d.node.key === key && d.node.status === status,
    timeoutMs,
  );

export const inboxOpens = (t: TestApp, kind: InboxItemDTO['kind']) =>
  waitForEvent(t.app.events, ServerEventType.InboxUpdated, (d) => d.item.kind === kind && d.item.status === 'open');

export type PlanNodeArgs = {
  key: string;
  role?: string;
  title?: string;
  depends_on?: string[];
  acceptance?: { command?: string; ai_review?: boolean; manual?: boolean };
};

/** `submit_plan` arguments; instructions are derived from the key. */
export const planArgs = (nodes: PlanNodeArgs[], extra: { assumptions?: string[] } = {}) => ({
  summary: 'Plan',
  ...extra,
  nodes: nodes.map(({ key, role, title, ...rest }) => ({
    key,
    title: title ?? key,
    role: role ?? 'developer',
    instructions: `Do ${key}`,
    ...rest,
  })),
});

/** The required last step of the feature workflow, as the planner must include it. */
export const finalVerify = (dependsOn: string[]): PlanNodeArgs => ({
  key: 'final_verify',
  role: 'tester',
  depends_on: dependsOn,
});
