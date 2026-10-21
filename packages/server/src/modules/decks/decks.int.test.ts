import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDeckOp,
  type DeckDTO,
  DeckRunKind,
  DeckStatus,
  deleteDeckOp,
  deleteProjectOp,
  ErrorCode,
  generateDeckOp,
  getDeckOp,
  listDecksOp,
  readonlyBashRules,
  restoreSlideOp,
  reviseOutlineOp,
  reviseSlidesOp,
  ServerEventType,
  SlideLayout,
  stopDeckOp,
  updateDeckOp,
  updateOutlineOp,
  updateSlideOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, taskInReview } from '../../../test/helpers/tasks.ts';

const WRITER = { agent: 'aw-slides' };
const UNDERSTANDING = { audience: '团队同事', duration: '约 10 分钟', assumptions: ['听众了解项目背景'] };
const OUTLINE = {
  title: '问候模块上线',
  understanding: UNDERSTANDING,
  slides: [
    { layout: SlideLayout.Cover, title: '问候模块上线', points: ['做了什么'] },
    { layout: SlideLayout.Bullets, title: '改动三件事', points: ['新增模块', '补了测试'] },
    { layout: SlideLayout.Steps, title: '上线步骤', points: ['评审', '合并'] },
  ],
};
const cover = (title = '问候模块上线') => ({ layout: SlideLayout.Cover, title, subtitle: '本周进展' });
const bullets = (items = ['新增 greet()', '补了单测']) => ({
  layout: SlideLayout.Bullets,
  title: '改动三件事',
  bullets: items,
});
const steps = { layout: SlideLayout.Steps, title: '上线步骤', steps: [{ label: '评审' }, { label: '合并' }] };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const ENDED = ['succeeded', 'failed', 'aborted', 'interrupted'];
/** Subscribe before the action: the next PPT work to end. */
const workEnds = () =>
  waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (d) => d.attempt.kind.startsWith('deck_') && ENDED.includes(d.attempt.status),
  );

const get = async (id: string): Promise<DeckDTO> => (await t.call(getDeckOp, { id })).body;

/** Runs an operation that starts AI work and waits until the work and its scripted turns are over. */
async function work(start: () => Promise<{ status: number; body: unknown }>, status = 200): Promise<void> {
  const ended = workEnds();
  const res = await start();
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  await ended;
  await t.fake.settled();
}

const outlineTurn = (outline: Record<string, unknown> = OUTLINE) => script().callTool('submit_outline', outline);

/** A PPT with its outline written (not confirmed). */
async function outlined(input: z.input<typeof createDeckOp.input>) {
  t.fake.enqueue(outlineTurn(), WRITER);
  let id = '';
  await work(async () => {
    const res = await t.call(createDeckOp, input);
    id = res.body.id;
    return res;
  }, 201);
  return get(id);
}

/** A PPT with its three pages made. */
async function made(): Promise<DeckDTO> {
  const deck = await outlined({
    brief: '向团队介绍问候模块\n十分钟',
    materials: [{ kind: 'text', content: '本周新增了问候模块。' }],
  });
  t.fake.enqueue(
    script()
      .callTool('submit_slide', { page: 1, content: cover() })
      .callTool('submit_slide', { page: 2, content: bullets(), notes: '先讲为什么' })
      .callTool('submit_slide', { page: 3, content: steps }),
    WRITER,
  );
  await work(() => t.call(generateDeckOp, { id: deck.id }));
  return get(deck.id);
}

const toolResults = (name: string) => t.fake.toolCalls.filter((c) => c.name === name);

describe('PPT', () => {
  it('从任务结果出大纲：只读会话、资料快照、页数校验；确认后逐页制作直到完成', async () => {
    const { project, repo } = await addProject(t, { files: { 'src/greet.ts': 'export const greet = () => "hi";\n' } });
    const task = await taskInReview(t, project.id, { 'src/greet.ts': 'export const greet = () => "hello";\n' });

    t.fake.enqueue(
      script()
        .callTool('submit_outline', { ...OUTLINE, slides: OUTLINE.slides.slice(0, 2) })
        .callTool('submit_outline', OUTLINE),
      WRITER,
    );
    let id = '';
    await work(async () => {
      const res = await t.call(createDeckOp, {
        brief: '把这次修复做成 3 页汇报',
        materials: [{ kind: 'task', taskId: task.id }],
        slideCount: 3,
        theme: 'warm',
      });
      id = res.body.id;
      return res;
    }, 201);

    const writer = t.fake.sessions.find((s) => s.agent === 'aw-slides');
    expect(writer).toMatchObject({ directory: repo.path, permission: readonlyBashRules() });
    const first = t.fake.prompts.find((p) => p.sessionId === writer?.id)?.text ?? '';
    expect(first).toContain('把这次修复做成 3 页汇报');
    expect(first).toContain(`# Task ${task.key}`);
    expect(first).toContain('Fixed: Fix the greeting');
    expect(first).toContain('src/greet.ts (+1 −1)');
    expect(first).toContain('exactly 3');
    // Two pages when three were asked for: rejected with the reason, the corrected outline is taken.
    expect(toolResults('submit_outline').map((c) => c.isError)).toEqual([true, false]);
    expect(JSON.stringify(toolResults('submit_outline')[0]?.result)).toContain('exactly 3 pages');

    let deck = await get(id);
    expect(deck).toMatchObject({
      title: '问候模块上线',
      theme: 'warm',
      status: DeckStatus.OutlineReady,
      project: { id: project.id },
      understanding: UNDERSTANDING,
      outlineConfirmed: false,
      materials: [{ kind: 'task', refId: task.id, title: `${task.key} · ${task.title}` }],
    });
    expect(deck.slides.map((s) => [s.seq, s.layout, s.title, s.content])).toEqual([
      [1, 'cover', '问候模块上线', null],
      [2, 'bullets', '改动三件事', null],
      [3, 'steps', '上线步骤', null],
    ]);

    // The user edits the outline: retitles page 2, drops page 3, adds a quote page.
    const [p1, p2] = deck.slides;
    deck = (
      await t.call(updateOutlineOp, {
        id,
        slides: [
          { id: p1?.id, layout: SlideLayout.Cover, title: '问候模块上线', points: [] },
          { id: p2?.id, layout: SlideLayout.Bullets, title: '改了两处', points: ['greet 返回 hello'] },
          { layout: SlideLayout.Quote, title: '结论', points: ['可以合并'] },
        ],
      })
    ).body;
    expect(deck.slides.map((s) => [s.seq, s.title])).toEqual([
      [1, '问候模块上线'],
      [2, '改了两处'],
      [3, '结论'],
    ]);
    expect(deck.slides[1]?.id).toBe(p2?.id);

    t.fake.enqueue(
      script()
        .callTool('submit_slide', { page: 1, content: cover() })
        // Not the right length, and a page that is not part of the work: both rejected with hints.
        .callTool('submit_slide', { page: 2, content: bullets(['这一条写得太长了'.repeat(10)]) })
        .callTool('submit_slide', { page: 9, content: cover() })
        .callTool('submit_slide', { page: 2, content: bullets(), notes: '讲两句' })
        .callTool('submit_slide', { page: 3, content: { layout: SlideLayout.Quote, quote: '**可以合并**' } }),
      WRITER,
    );
    await work(() => t.call(generateDeckOp, { id }));

    const slides = toolResults('submit_slide');
    expect(slides.map((c) => c.isError)).toEqual([false, true, true, false, false]);
    expect(JSON.stringify(slides[1]?.result)).toContain('bullets');
    expect(JSON.stringify(slides[2]?.result)).toContain('Page 9 is not one of the pages of this work: 1, 2, 3');
    expect(slides.map((c) => (c.result as { remaining?: number[] }).remaining)).toEqual([
      [2, 3],
      undefined,
      undefined,
      [3],
      [],
    ]);
    // The writer kept its session: the pages were asked for on it, with the edited outline.
    expect(t.fake.sessions.filter((s) => s.agent === 'aw-slides')).toHaveLength(1);
    expect(t.fake.prompts.at(-1)?.text).toContain('### Page 2 · `bullets` · 改了两处\n- greet 返回 hello');

    deck = await get(id);
    expect(deck.status).toBe(DeckStatus.Ready);
    expect(deck.outlineConfirmed).toBe(true);
    expect(deck.slides.map((s) => [s.layout, s.notes, s.hasPrevious])).toEqual([
      ['cover', '', false],
      ['bullets', '讲两句', false],
      ['quote', '', false],
    ]);
    expect(deck.runs.map((r) => [r.kind, r.attempt.status, r.done.length])).toEqual([
      [DeckRunKind.Outline, 'succeeded', 0],
      [DeckRunKind.Slides, 'succeeded', 3],
    ]);
    // Generating again has nothing left to make.
    expect((await t.call(generateDeckOp, { id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });

    const { body: list } = await t.call(listDecksOp, { projectId: project.id });
    expect(list.items).toEqual([
      expect.objectContaining({ id, status: DeckStatus.Ready, slideCount: 3, madeCount: 3, cover: cover() }),
    ]);
  });

  it('按意见重写大纲沿用同一会话并带上手改的大纲；确认后不能再改大纲', async () => {
    const deck = await outlined({ brief: '介绍问候模块' });
    const [first, ...rest] = deck.slides;
    await t.call(updateOutlineOp, {
      id: deck.id,
      slides: [{ id: first?.id, layout: SlideLayout.Cover, title: '我改过的封面', points: [] }, ...rest],
    });

    t.fake.enqueue(outlineTurn({ ...OUTLINE, title: '重写后的标题' }), WRITER);
    await work(() => t.call(reviseOutlineOp, { id: deck.id, instruction: '少讲背景' }));

    expect(t.fake.sessions).toHaveLength(1);
    const prompt = t.fake.prompts.at(-1)?.text ?? '';
    expect(prompt).toContain('少讲背景');
    expect(prompt).toContain('我改过的封面');
    expect(prompt).not.toContain('## Brief');
    expect((await get(deck.id)).title).toBe('重写后的标题');

    // A renamed PPT keeps its name when the outline is rewritten.
    await t.call(updateDeckOp, { id: deck.id, title: '我的标题' });
    t.fake.enqueue(outlineTurn(), WRITER);
    await work(() => t.call(reviseOutlineOp, { id: deck.id, instruction: '再短一点' }));
    expect((await get(deck.id)).title).toBe('我的标题');

    t.fake.enqueue(script().hang(), WRITER);
    await t.call(generateDeckOp, { id: deck.id });
    expect((await t.call(reviseOutlineOp, { id: deck.id, instruction: '改' })).body).toMatchObject({
      error: { code: ErrorCode.DeckBusy },
    });
    const stopped = workEnds();
    await t.call(stopDeckOp, { id: deck.id });
    await stopped;
    expect((await t.call(reviseOutlineOp, { id: deck.id, instruction: '改' })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });

  it('让 AI 改一页保留上一版，可以恢复；手动修改不覆盖上一版', async () => {
    const deck = await made();
    const page2 = deck.slides[1];
    if (page2 === undefined) throw new Error('no page 2');

    t.fake.enqueue(script().callTool('submit_slide', { page: 2, content: bullets(['只留一条']) }), WRITER);
    await work(() => t.call(reviseSlidesOp, { id: deck.id, slideIds: [page2.id], instruction: '精简到一条' }));
    const prompt = t.fake.prompts.at(-1)?.text ?? '';
    expect(prompt).toContain('精简到一条');
    expect(prompt).toContain('新增 greet()');
    expect(prompt).toContain('先讲为什么');

    let revised = await get(deck.id);
    expect(revised.slides[1]).toMatchObject({ content: bullets(['只留一条']), notes: '', hasPrevious: true });

    const edited = { ...bullets(['只留一条，我补一句']), title: '我改的标题' };
    revised = (await t.call(updateSlideOp, { id: deck.id, slideId: page2.id, content: edited, notes: '手写' })).body;
    expect(revised.slides[1]).toMatchObject({ content: edited, notes: '手写', hasPrevious: true });

    revised = (await t.call(restoreSlideOp, { id: deck.id, slideId: page2.id })).body;
    expect(revised.slides[1]).toMatchObject({ content: bullets(), notes: '先讲为什么', hasPrevious: false });
    expect((await t.call(restoreSlideOp, { id: deck.id, slideId: page2.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });

  it('停止后显示没做完，继续制作只做剩下的页；制作中不能改内容', async () => {
    const deck = await outlined({ brief: '介绍问候模块' });
    t.fake.enqueue(script().callTool('submit_slide', { page: 1, content: cover() }).hang(), WRITER);
    // The turn keeps working after page 1: wait for that page, not for the turn.
    const firstPage = waitForEvent(
      t.app.events,
      ServerEventType.DeckUpdated,
      (d) => t.app.services.decks.get(d.deckId).slides[0]?.content !== null,
    );
    await t.call(generateDeckOp, { id: deck.id });
    await firstPage;

    const busy = await get(deck.id);
    expect(busy.status).toBe(DeckStatus.Generating);
    expect((await t.call(updateDeckOp, { id: deck.id, theme: 'spdb' })).status).toBe(200);
    const page1 = busy.slides[0];
    if (page1 === undefined) throw new Error('no page 1');
    expect(
      (await t.call(updateSlideOp, { id: deck.id, slideId: page1.id, content: cover('x'), notes: '' })).body,
    ).toMatchObject({
      error: { code: ErrorCode.DeckBusy },
    });
    expect((await t.call(deleteDeckOp, { id: deck.id })).body).toMatchObject({ error: { code: ErrorCode.DeckBusy } });

    const stopped = workEnds();
    await t.call(stopDeckOp, { id: deck.id });
    await stopped;
    let after = await get(deck.id);
    expect(after.status).toBe(DeckStatus.Incomplete);
    expect(after.slides.map((s) => s.content !== null)).toEqual([true, false, false]);

    t.fake.enqueue(
      script()
        .callTool('submit_slide', { page: 2, content: bullets() })
        .callTool('submit_slide', { page: 3, content: steps }),
      WRITER,
    );
    await work(() => t.call(generateDeckOp, { id: deck.id }));
    after = await get(deck.id);
    expect(after.status).toBe(DeckStatus.Ready);
    expect(after.runs.at(-1)?.targets).toEqual(after.slides.slice(1).map((s) => s.id));
    expect(t.fake.prompts.at(-1)?.text).not.toContain('### Page 1');
  });

  it('没有项目时在空白目录中工作；PPT 的会话不能用任务工具', async () => {
    t.fake.enqueue(
      script()
        .callTool('submit_result', { summary: 'x' })
        .ask({ question: '几页？', blocking: true })
        .callTool('submit_outline', OUTLINE),
      WRITER,
    );
    await work(
      () =>
        t.call(createDeckOp, { brief: '把这段文字做成 PPT', materials: [{ kind: 'text', content: '第一行\n第二行' }] }),
      201,
    );

    expect(t.fake.sessions[0]?.directory).toBe(join(t.dataDir, 'ppt', 'blank'));
    expect(t.fake.prompts[0]?.text).toContain(
      '<material index="1" kind="text" title="第一行">\n第一行\n第二行\n</material>',
    );
    expect(toolResults('submit_result')[0]?.isError).toBe(true);
    expect(toolResults('ask_user')[0]?.isError).toBe(true);
    const { body: list } = await t.call(listDecksOp, {});
    expect(list.items[0]).toMatchObject({ project: null, status: DeckStatus.OutlineReady, cover: null });
  });

  it('删除 PPT 清理它的尝试与会话流；删除项目后 PPT 保留', async () => {
    const { project } = await addProject(t);
    const deck = await outlined({ brief: '介绍', projectId: project.id });
    const attemptId = deck.runs[0]?.attempt.id ?? '';
    const transcript = join(t.dataDir, 'runs', 'ppt', `${attemptId}.jsonl`);
    expect(existsSync(transcript)).toBe(true);

    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
    expect((await get(deck.id)).project).toBeNull();

    expect((await t.call(deleteDeckOp, { id: deck.id })).status).toBe(204);
    expect((await t.call(getDeckOp, { id: deck.id })).body).toMatchObject({ error: { code: ErrorCode.DeckNotFound } });
    expect(existsSync(transcript)).toBe(false);
  });
});
