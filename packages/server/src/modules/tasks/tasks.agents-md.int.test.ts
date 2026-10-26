import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAgentsMdOp, getTaskOp, startAgentsMdTaskOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('projects.agentsMd（40 §6）', () => {
  it('读默认分支上已提交的 AGENTS.md：没有时为 null，主工作区未提交的不算；规则里是项目的检查命令', async () => {
    const { repo, project } = await addProject(t, { checkCommand: 'pnpm verify' });
    await writeFile(join(repo.path, 'AGENTS.md'), '# draft\n');

    const { body } = await t.call(getAgentsMdOp, { id: project.id });
    expect(body).toMatchObject({ branch: 'main', file: null, task: null });
    expect(body.rules).toMatch(/^## 在 Agent Workflow 中工作/);
    expect(body.rules).toContain('提交结果前运行项目的检查命令 `pnpm verify`');
  });

  it('有 AGENTS.md 时返回其内容；项目没有检查命令时规则改为运行项目的测试', async () => {
    const { project } = await addProject(t, { files: { 'AGENTS.md': '# Rules\n\nUse pnpm.\n' }, checkCommand: null });
    const { body } = await t.call(getAgentsMdOp, { id: project.id });
    expect(body.file).toEqual({ path: 'AGENTS.md', content: '# Rules\n\nUse pnpm.\n' });
    expect(body.rules).toContain('提交结果前运行项目的测试');
  });
});

describe('projects.startAgentsMdTask（40 §4）', () => {
  it('没有 AGENTS.md：开出「生成 AGENTS.md」任务，需求含补充说明与规则；两步写好后到待合并，面板指向这个任务', async () => {
    const { project } = await addProject(t, { checkCommand: 'pnpm verify' });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'pnpm verify runs everything' }), {
      title: '· 梳理项目约定',
    });
    t.fake.enqueue(
      script()
        .edit('AGENTS.md', '# AGENTS.md\n\nRun `pnpm verify`.\n')
        .callTool('submit_result', {
          summary: 'Wrote AGENTS.md',
          changes: [{ path: 'AGENTS.md', description: 'new' }],
        }),
      { title: '· 编写 AGENTS.md' },
    );
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Accurate' }), {
      agent: 'aw-reviewer',
    });
    const review = taskReaches(t, 'review');

    const { body: task } = await t.call(startAgentsMdTaskOp, {
      id: project.id,
      guidance: '测试用 vitest',
      includeRules: true,
    });
    const { body: rules } = await t.call(getAgentsMdOp, { id: project.id });
    expect(task).toMatchObject({ title: '生成 AGENTS.md', workflow: { key: 'system.agents_md' } });
    expect(rules.task).toMatchObject({ id: task.id });
    expect(task.requirement).toBe(
      [
        '为项目生成 AGENTS.md。',
        '项目的检查命令：`pnpm verify`。',
        '补充说明：\n\n测试用 vitest',
        `在 AGENTS.md 中加入下面这一节（已有同名一节时替换它）：\n\n${rules.rules}`,
      ].join('\n\n'),
    );

    await review;
    const { body: done } = await t.call(getTaskOp, { id: task.id });
    expect(done.nodes.map((n) => [n.key, n.status])).toEqual([
      ['survey', 'done'],
      ['write', 'done'],
    ]);
    expect(done.result?.files).toEqual([expect.objectContaining({ path: 'AGENTS.md', status: 'added' })]);
  });

  it('已有 AGENTS.md：任务为「补充 AGENTS.md」，不勾规则时需求里没有规则一节', async () => {
    const { project } = await addProject(t, { files: { 'AGENTS.md': '# Rules\n' } });
    const { body: task } = await t.call(startAgentsMdTaskOp, { id: project.id, includeRules: false });
    expect(task.title).toBe('补充 AGENTS.md');
    expect(task.requirement).toBe('补充项目的 AGENTS.md，保留已有内容。\n\n项目没有设置检查命令。');
  });
});
