import {
  confirmAssistantCallOp,
  createProjectOp,
  listAssistantMemoriesOp,
  listConfirmationsOp,
  MCP_ASSISTANT_TOOL_PREFIX,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { SkillName } from '../packages/builtin/src/skills.ts';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { startAssistantEvaluation } from './assistant-evaluation.ts';

it('@live 明确提议保存，经确认后新项目对话会使用记忆，其他项目不会看到', async () => {
  const evaluation = await startAssistantEvaluation('memory');
  const { t } = evaluation;
  try {
    const order = await createTestRepo();
    const report = await createTestRepo();
    const { body: project } = await t.call(createProjectOp, { repoPath: order.path, name: '订单项目' });
    const { body: other } = await t.call(createProjectOp, { repoPath: report.path, name: '报表项目' });
    const question = '请仅根据这个项目已保存的助手记忆告诉我交付代号。没有就只回复「未知」。';
    const code = '松塔-4729';
    const before = await evaluation.conversation('保存前', project.id);
    expect((await evaluation.turn(before, 'before-save', question)).reply).toContain('未知');

    const source = await evaluation.conversation('提出记忆', project.id);
    const proposal = await evaluation.turn(source, 'proposal', `请记住，仅限这个项目，以后的交付代号叫「${code}」。`);
    const skill = proposal.tools.findIndex(
      (call) => call.tool === 'skill' && call.input.name === SkillName.AssistantMemory,
    );
    const save = proposal.tools.findIndex((call) => call.tool === `${MCP_ASSISTANT_TOOL_PREFIX}memory_create`);
    expect(skill).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(skill);
    const [confirmation] = (await t.call(listConfirmationsOp, { id: source })).body.items;
    if (confirmation === undefined) throw new Error('Expected a memory proposal');
    expect(confirmation.input).toMatchObject({ projectId: project.id, content: expect.stringContaining(code) });
    expect((await t.call(listAssistantMemoriesOp, {})).body.items).toEqual([]);
    expect((await t.call(confirmAssistantCallOp, { id: confirmation.id })).body.result).toMatchObject({ ok: true });

    const recalled = await evaluation.conversation('新订单对话', project.id);
    expect((await evaluation.turn(recalled, 'recall-allowed', question)).reply).toContain(code);
    const isolated = await evaluation.conversation('新报表对话', other.id);
    expect((await evaluation.turn(isolated, 'recall-isolated', question)).reply).toContain('未知');
  } finally {
    await evaluation.close();
  }
}, 360_000);
