import { mkdir, writeFile } from 'node:fs/promises';
import {
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  createConversationOp,
  createInitiativeOp,
  deliverInitiativePhaseOp,
  type InitiativeDetailDTO,
  InitiativeStatus,
  listConfirmationsOp,
  ServerEventType,
  sendAssistantMessageOp,
  TaskStatus,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { type LiveApp, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/** N-08 (34 §13): the AI breakdown of an initiative on a real model, against the rules of D133; the assistant's way in. */
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
  it(
    '助手：附上需求文档说「拆成需求计划」，助手调用 initiatives_create 并带上附件，等用户确认',
    async () => {
      const projectId = await live.addProject('todo-web');
      const upload = await live.t.request({
        method: 'POST',
        url: '/attachments',
        headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: '待办二期需求.md' },
        payload: TODO,
      });
      const doc = upload.json<AttachmentDTO>();
      const { body: conversation } = await live.t.call(createConversationOp, {});
      const idle = waitForEvent(
        live.t.app.events,
        ServerEventType.AssistantUpdated,
        (c) => c.id === conversation.id && !c.busy,
        TASK_TIMEOUT_MS,
      );
      await live.t.call(sendAssistantMessageOp, {
        id: conversation.id,
        text: '附件是待办应用二期的需求文档，内容比较多。帮我在项目 todo-web 上把它拆成需求计划，分阶段做。',
        context: { page: 'project', params: { projectId } },
        attachmentIds: [doc.id],
      });
      await idle;

      const { items } = (await live.t.call(listConfirmationsOp, { id: conversation.id })).body;
      expect(items.map((c) => c.operationId)).toEqual(['initiatives.create']);
      expect(items[0]?.input).toMatchObject({ projectId, attachmentIds: [doc.id] });
    },
    TASK_TIMEOUT_MS,
  );
  it(
    '两阶段三个工作包跑通（开发后审查）：开发合入后审查阶段自动开启，代码审查与安全审查都完成，需求计划全部完成',
    async () => {
      const projectId = await live.addProject('ts-stats');
      const started = Date.now();
      const ENDED: readonly string[] = [TaskStatus.Review, TaskStatus.Failed, TaskStatus.Cancelled];
      let id = '';
      const detail = () => live.t.app.services.initiatives.detail(id);
      /** Waits until `done` holds for the initiative, re-checking whenever it or a task changes (07 §4: no sleeping). */
      const until = (done: (d: InitiativeDetailDTO) => boolean) =>
        new Promise<InitiativeDetailDTO>((resolve, reject) => {
          const timer = setTimeout(() => {
            off();
            reject(
              new Error(
                `Timed out; initiative is ${JSON.stringify(detail().items.map((i) => [i.key, i.status, i.task?.status]))}`,
              ),
            );
          }, TASK_TIMEOUT_MS);
          const check = () => {
            const current = detail();
            if (!done(current)) return;
            clearTimeout(timer);
            off();
            resolve(current);
          };
          const off = live.t.app.events.subscribe((e) => {
            if (e.type === ServerEventType.InitiativeUpdated || e.type === ServerEventType.TaskUpdated) check();
          });
          check();
        });
      const ended = (d: InitiativeDetailDTO, keys: readonly string[]) =>
        keys.every((key) => ENDED.includes(d.items.find((i) => i.key === key)?.task?.status ?? ''));
      const tasksOf = (d: InitiativeDetailDTO) =>
        d.items.map((i) => [i.key, i.status, i.task?.key ?? null, i.task?.status ?? null]);

      const created = await live.t.call(createInitiativeOp, {
        projectId,
        templateKey: 'build_then_review',
        requirement:
          '在 src/stats.ts 增加 mode(values) 函数：返回出现次数最多的值，次数相同时返回其中最小的值，空数组时抛出错误；并在 test 目录补上它的测试。',
      });
      expect(created.status).toBe(201);
      id = created.body.id;

      const built = await until((d) => ended(d, ['build']));
      expect(tasksOf(built)).toContainEqual(['build', 'in_task', expect.any(String), TaskStatus.Review]);
      const first = await live.t.call(deliverInitiativePhaseOp, { id, phase: 1, strategy: 'squash' });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      // Satisfied by the merge, the review phase opens by itself (autoOpen) and both reviews start.
      const reviewed = await until((d) => ended(d, ['review', 'security']));
      expect(reviewed.openedPhase).toBe(2);
      expect(
        tasksOf(reviewed)
          .filter(([key]) => key !== 'build')
          .map(([, , , status]) => status),
      ).toEqual([TaskStatus.Review, TaskStatus.Review]);
      const second = await live.t.call(deliverInitiativePhaseOp, { id, phase: 2 });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const done = await until((d) => d.status === InitiativeStatus.Done);

      await mkdir(new URL('reports', import.meta.url), { recursive: true });
      await writeFile(
        new URL(`reports/initiative-run-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url),
        JSON.stringify(
          {
            minutes: Math.round((Date.now() - started) / 6000) / 10,
            items: tasksOf(done),
            deliveries: [first.body, second.body],
          },
          null,
          2,
        ),
      );
      expect(done.items.map((i) => [i.key, i.status])).toEqual([
        ['build', 'satisfied'],
        ['review', 'satisfied'],
        ['security', 'satisfied'],
      ]);
    },
    3 * TASK_TIMEOUT_MS,
  );
});
