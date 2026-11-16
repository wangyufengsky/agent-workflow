import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AcceptanceCheckKind,
  AttemptKind,
  attemptMachine,
  createWorkflowOp,
  getGitReviewOp,
  isTerminalState,
  ServerEventType,
  startGitReviewOp,
  TaskStatus,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BuiltinRoleKey } from '../packages/builtin/src/roles.ts';
import { SkillName } from '../packages/builtin/src/skills.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

function loadedReviewSkill(live: LiveApp, attemptId: string) {
  const { entries } = live.t.app.services.attempts.transcript(attemptId, 0);
  const call = entries.find(
    (entry) =>
      entry.kind === 'tool_call' && entry.data.tool === 'skill' && entry.data.input.name === SkillName.CodeReview,
  );
  return (
    call?.kind === 'tool_call' &&
    entries.some(
      (entry) =>
        entry.kind === 'tool_result' && entry.data.callId === call.data.callId && entry.data.status === 'completed',
    )
  );
}

/** ts-stats as of 2026-09-25, plus `percentile` added on 2026-10-05 with an off-by-one index and an unused helper. */
const STATS_HISTORY = {
  initAt: '2026-09-25T10:00:00',
  commits: [
    {
      date: '2026-10-05T10:00:00',
      message: 'add percentile',
      files: {
        'src/percentile.ts': [
          '/** The value below which `p` percent of the values fall (nearest rank). */',
          'export function percentile(values: readonly number[], p: number): number {',
          '  const sorted = [...values].sort((a, b) => a - b);',
          '  return sorted[Math.ceil((p / 100) * sorted.length)];',
          '}',
          '',
          'function clamp(value: number, low: number, high: number): number {',
          '  return Math.min(Math.max(value, low), high);',
          '}',
          '',
        ].join('\n'),
      },
    },
  ],
};

let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('workflows');
}, 120_000);
afterAll(() => live.close());

/**
 * M6-05 live suite (07 §6): with smoke.live.test.ts every built-in workflow runs once; the Java fixture runs its
 * check with Maven. Run by hand: `pnpm test:live`.
 */
describe('@live 内置流程全集', () => {
  it(
    'bugfix（Java / Maven）：lowStock 漏掉了等于阈值的商品',
    async () => {
      const task = await live.runTask(
        'bugfix',
        'java-inventory',
        'Inventory.lowStock(threshold) 应返回库存小于等于阈值的商品，但库存正好等于阈值的商品没有被列出。请找到原因并修复。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const source = await readFile(
        join(task.git.worktreePath ?? '', 'src/main/java/inventory/Inventory.java'),
        'utf8',
      );
      expect(source).toContain('<= threshold');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'unit_tests：为 average 补单元测试',
    async () => {
      const task = await live.runTask(
        'unit_tests',
        'ts-stats',
        '为 src/stats.ts 中的 average 补充单元测试，覆盖普通输入与只有一个元素的输入。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.files.some((f) => f.path.startsWith('test/'))).toBe(true);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'code_review（Java）：审查 Inventory，只出报告不改代码',
    async () => {
      const task = await live.runTask('code_review', 'java-inventory', '审查 src/main/java/inventory/Inventory.java。');
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary.length).toBeGreaterThan(0);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'refactor（Java / Maven）：提取重复的数量校验，行为不变',
    async () => {
      const task = await live.runTask(
        'refactor',
        'java-inventory',
        'Inventory 的 add 与 remove 中重复了「quantity 必须为正数」的校验，把它提取为一个私有方法，外部行为保持不变。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBeGreaterThan(0);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    '代码步骤验收：加载 Skill 并用 submit_review 给出结果',
    async () => {
      const { t } = live;
      const workflow = await t.call(createWorkflowOp, {
        key: 'review_skill_step',
        name: '代码审查 Skill 验收',
        planning: WorkflowPlanning.Fixed,
        deliverable: WorkflowDeliverable.CodeChanges,
        definition: {
          allowedRoles: [BuiltinRoleKey.Developer],
          template: {
            nodes: [
              {
                key: 'fix_median',
                title: '改用数值排序',
                roleKey: BuiltinRoleKey.Developer,
                instructions: '仅将 src/stats.ts 中 median 的 sort() 改为 sort((a, b) => a - b)，避免字符串排序。',
                dependsOn: [],
              },
            ],
          },
          checkpoints: { confirm_plan: false, accept_each_node: false },
          defaultAcceptance: {
            checks: [
              {
                kind: AcceptanceCheckKind.AiReview,
                focus: '验证 median 的比较器按数值升序排序，包括输入 [10, 9, 1]。',
              },
            ],
            manual: false,
          },
        },
      });
      expect(workflow.status).toBe(201);
      const task = await live.runTask(workflow.body.key, 'ts-stats', '让 median([10, 9, 1]) 返回 9。');
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'ai_review', passed: true })]),
      );
      const attempts = t.app.services.attempts.listByTask(task.id);
      expect(attempts.some(({ id, kind }) => kind === AttemptKind.Review && loadedReviewSkill(live, id))).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'version_review：审查 10 月 1 日以来新增的 percentile（median 的排序问题在那之前就有）',
    async () => {
      const task = await live.runTask(
        'version_review',
        'ts-stats',
        '对比 main 分支 2026-10-01 的版本，审查之后新增的代码。',
        { history: STATS_HISTORY },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('percentile');
      const attempts = live.t.app.services.attempts.listByTask(task.id);
      expect(attempts.some(({ id }) => loadedReviewSkill(live, id))).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'Git 工作台代码审查：加载 Skill 并提交该提交引入的越界问题',
    async () => {
      const { t } = live;
      const projectId = await live.addProject('ts-stats', STATS_HISTORY);
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt }) => attempt.kind === AttemptKind.GitReview && isTerminalState(attemptMachine, attempt.status),
        TASK_TIMEOUT_MS,
      );
      const started = await t.call(startGitReviewOp, {
        id: projectId,
        target: { kind: 'commit', sha: 'HEAD' },
        focus: '确认新增 percentile 函数的数组索引是否正确，给出能触发越界的输入。',
      });
      expect(started.status).toBe(201);
      await ended;
      const { body: review } = await t.call(getGitReviewOp, { reviewId: started.body.id });
      expect(review.status).toBe('succeeded');
      expect(loadedReviewSkill(live, review.attemptId)).toBe(true);
      expect(review.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'src/percentile.ts', line: 4 })]),
      );
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'security_review：静态服务器的路径穿越',
    async () => {
      const task = await live.runTask('security_review', 'todo-web', '审查 server.mjs 的安全问题。');
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('server.mjs');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'cleanup：删除没有被使用的 clamp，保留导出的 percentile，检查通过',
    async () => {
      const task = await live.runTask('cleanup', 'ts-stats', '清理 src 目录中没有被使用的代码。', {
        history: STATS_HISTORY,
      });
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const source = await readFile(join(task.git.worktreePath ?? '', 'src/percentile.ts'), 'utf8');
      expect(source).not.toContain('clamp');
      expect(source).toContain('export function percentile');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'design_proposal（Java）：按类别统计库存，只出方案不改代码',
    async () => {
      const task = await live.runTask(
        'design_proposal',
        'java-inventory',
        '想给 Inventory 增加按商品类别统计库存总量的功能，请给出设计方案。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('Inventory');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'detailed_design（Java）：写设计文档，不改代码',
    async () => {
      const task = await live.runTask(
        'detailed_design',
        'java-inventory',
        '为 Inventory 增加按商品类别统计库存总量的功能，写一份详细设计。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.files.some((f) => f.path.endsWith('.md'))).toBe(true);
      expect(task.result?.files.some((f) => f.path.endsWith('.java'))).toBe(false);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'breakdown：把多项需求拆成分阶段的工作包，只写一份拆解文档',
    async () => {
      const task = await live.runTask(
        'breakdown',
        'ts-stats',
        [
          '统计库二期需求：',
          '1. 新增 percentile(values, p)：最近秩法，p 取 0–100，越界时抛错。',
          '2. 新增 mode(values)：返回出现次数最多的值，次数相同时返回较小的值。',
          '3. 新增 variance(values) 与 stddev(values)：总体方差与标准差。',
          '4. 新增 summarize(values)：一次返回 average、median、stddev、最小值与最大值。',
          '5. 所有函数对空数组抛出同一个错误类型 EmptyInputError，现有的 average 与 median 也改成这样。',
        ].join('\n'),
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const docs = task.result?.files.filter((f) => f.path.endsWith('.md')) ?? [];
      expect(docs).toHaveLength(1);
      expect(task.result?.files.some((f) => f.path.endsWith('.ts'))).toBe(false);
      const doc = await readFile(join(task.git.worktreePath ?? '', docs[0]?.path ?? ''), 'utf8');
      for (const name of ['percentile', 'mode', 'stddev', 'summarize', 'EmptyInputError']) expect(doc).toContain(name);
    },
    TASK_TIMEOUT_MS,
  );
});
