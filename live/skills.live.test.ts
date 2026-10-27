import { createProjectOp, MCP_ASSISTANT_TOOL_PREFIX } from '@aw/shared';
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
beforeAll(async () => {
  evaluation = await startAssistantEvaluation('skills');
  const repo = await createTestRepo({ files: { 'src/orders.ts': 'export const orders: string[] = [];\n' } });
  expect((await evaluation.t.call(createProjectOp, { repoPath: repo.path, name: PROJECT_NAME })).status).toBe(201);
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
