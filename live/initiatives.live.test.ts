import { mkdir, writeFile } from 'node:fs/promises';
import { createInitiativeOp, InitiativeStatus, ServerEventType } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { type LiveApp, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/** N-08 (34 §13): the AI breakdown of an initiative on a real model, against the rules of D133. */
const TODO = `# 待办应用二期需求

1. 数据持久化：待办保存到服务端（server.mjs 增加 JSON 文件存储与 REST 接口：列表、新增、修改、删除），刷新页面后数据还在。
2. 待办字段：除了标题，还有完成状态、所属分类（工作 / 生活 / 学习，可自定义新增分类）、截止日期（可空）、创建时间。
3. 完成与删除：每条待办可以勾选完成、取消完成、删除；已完成的显示删除线。
4. 搜索与筛选：按标题关键字搜索；按分类、完成状态、是否过期筛选；筛选条件写在地址栏里，刷新后保留。
5. 到期提醒：截止日期在 24 小时内的待办标黄，已过期的标红；页面顶部显示「今天到期 N 条、已过期 M 条」。
6. 导入导出：导出为 JSON 与 CSV；导入 JSON 时按标题加创建时间去重。
7. 统计页：新增 /stats 页面，显示各分类的总数与完成率。

不做：登录与多用户。验收：所有接口有测试（node --test），页面上的关键交互在浏览器里能用。
`;

let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('initiatives');
}, 120_000);
afterAll(() => live.close());

describe('@live 需求计划的 AI 拆解', () => {
  it(
    '待办应用二期：拆成不超过 6 个阶段的草稿，流程都在允许范围内，覆盖每一点，核验命令不用内联脚本',
    async () => {
      const projectId = await live.addProject('todo-web');
      const started = Date.now();
      let id = '';
      const ended = waitForEvent(
        live.t.app.events,
        ServerEventType.InitiativeUpdated,
        (d) =>
          d.initiativeId === id && live.t.app.services.initiatives.detail(id).status !== InitiativeStatus.BreakingDown,
        TASK_TIMEOUT_MS,
      );
      const created = await live.t.call(createInitiativeOp, {
        projectId,
        requirement: TODO,
        allowedWorkflows: ['feature', 'bugfix', 'unit_tests', 'detailed_design'],
      });
      expect(created.status).toBe(201);
      id = created.body.id;
      await ended;
      const draft = live.t.app.services.initiatives.detail(id);
      await mkdir(new URL('reports', import.meta.url), { recursive: true });
      await writeFile(
        new URL(`reports/initiative-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url),
        JSON.stringify({ minutes: Math.round((Date.now() - started) / 6000) / 10, draft }, null, 2),
      );

      expect(draft.status).toBe(InitiativeStatus.DraftReady);
      expect(draft.phases.length).toBeLessThanOrEqual(6);
      expect(draft.items.length).toBeGreaterThanOrEqual(3);
      expect(
        draft.items.every((i) => ['feature', 'bugfix', 'unit_tests', 'detailed_design'].includes(i.workflow)),
      ).toBe(true);
      expect(draft.coverage?.length ?? 0).toBeGreaterThanOrEqual(7);
      const commands = draft.items.flatMap((i) =>
        i.acceptance.flatMap((a) => (a.verification.kind === 'command' ? [a.verification.command] : [])),
      );
      expect(commands.filter((c) => /node -e|python -c/.test(c))).toEqual([]);
    },
    TASK_TIMEOUT_MS,
  );
});
