import {
  createProjectOp,
  createTaskOp,
  getTaskOp,
  listWorkflowsOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  TaskStatus,
} from '@aw/shared';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { SkillName } from '../packages/builtin/src/skills.ts';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { type AssistantEvaluation, startAssistantEvaluation } from './assistant-evaluation.ts';

/**
 * SK-02 (41 §9): the assistant loads the skill its instructions name before it creates a task. Which agent sees which
 * skill is checked without a model in `opencode.skills.oc.test.ts`.
 */
const PROJECT_NAME = '订单服务';

let evaluation: AssistantEvaluation;
let projectId: string;
beforeAll(async () => {
  evaluation = await startAssistantEvaluation('skills');
  const repo = await createTestRepo({ files: { 'src/orders.ts': 'export const orders: string[] = [];\n' } });
  const created = await evaluation.t.call(createProjectOp, { repoPath: repo.path, name: PROJECT_NAME });
  expect(created.status).toBe(201);
  projectId = created.body.id;
}, 60_000);
afterEach((context) => {
  evaluation.facts.testResult = context.task.result;
});
afterAll(() => evaluation.close());

it('@live 建任务之前先加载 aw-task-requirement，再调用 tasks_create', async () => {
  const id = await evaluation.conversation('建任务前加载 skill');
  const turn = await evaluation.turn(
    id,
    'create-task',
    `在「${PROJECT_NAME}」项目里新建一个任务：订单列表页加一个按下单日期筛选的条件。直接创建，不用再问我。`,
  );
  const calls = turn.tools.map((call) => ({ tool: call.tool, name: call.input.name }));
  const skill = calls.findIndex((call) => call.tool === 'skill' && call.name === SkillName.TaskRequirement);
  const create = calls.findIndex((call) => call.tool === `${MCP_ASSISTANT_TOOL_PREFIX}tasks_create`);
  expect(skill, JSON.stringify(calls)).toBeGreaterThanOrEqual(0);
  expect(create, JSON.stringify(calls)).toBeGreaterThan(skill);
});

it('@live 交付前判断先加载 Skill，查询草稿且不发起交付', async () => {
  const { t } = evaluation;
  const { body } = await t.call(listWorkflowsOp, {});
  const workflow = body.items.find(({ key }) => key === 'frontend');
  if (workflow === undefined) throw new Error('Frontend workflow missing');
  const draft = await t.call(createTaskOp, {
    projectId,
    workflowId: workflow.id,
    title: '订单页面交付测试',
    requirement: '开发订单页面。',
    start: false,
  });
  expect(draft.status).toBe(201);
  const id = await evaluation.conversation('核对交付状态');
  const turn = await evaluation.turn(
    id,
    'check-delivery',
    `请查「订单页面交付测试」（${draft.body.key}）现在能否交付。只查询并告诉我下一步。`,
  );
  const tools = turn.tools.map(({ tool, input }) => ({ tool, name: input.name }));
  expect(tools).toContainEqual({ tool: 'skill', name: SkillName.TaskDelivery });
  expect(tools.some(({ tool }) => tool === `${MCP_ASSISTANT_TOOL_PREFIX}tasks_get`)).toBe(true);
  expect(tools.some(({ tool }) => tool === `${MCP_ASSISTANT_TOOL_PREFIX}tasks_deliver`)).toBe(false);
  expect((await t.call(getTaskOp, { id: draft.body.id })).body.status).toBe(TaskStatus.Draft);
});
