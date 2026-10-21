import { describe, expect, it } from 'vitest';
import { DeckRunKind, DeckStatus } from '../enums/deck.ts';
import { AttemptStatus } from '../enums/task.ts';
import { deckStatusOf } from './status.ts';

const run = (kind: DeckRunKind, status: AttemptStatus) => ({ kind, status });

describe('deckStatusOf', () => {
  it.each([
    ['写大纲中', false, 0, 0, run(DeckRunKind.Outline, AttemptStatus.Running), DeckStatus.Outlining],
    ['按意见重写大纲中', false, 5, 0, run(DeckRunKind.Outline, AttemptStatus.Starting), DeckStatus.Outlining],
    ['大纲待确认', false, 5, 0, run(DeckRunKind.Outline, AttemptStatus.Succeeded), DeckStatus.OutlineReady],
    ['重写失败仍保留旧大纲', false, 5, 0, run(DeckRunKind.Outline, AttemptStatus.Failed), DeckStatus.OutlineReady],
    ['没能写出大纲', false, 0, 0, run(DeckRunKind.Outline, AttemptStatus.Interrupted), DeckStatus.Failed],
    ['制作中', true, 5, 2, run(DeckRunKind.Slides, AttemptStatus.Running), DeckStatus.Generating],
    ['修改中', true, 5, 5, run(DeckRunKind.Slides, AttemptStatus.Running), DeckStatus.Generating],
    ['停止后没做完', true, 5, 2, run(DeckRunKind.Slides, AttemptStatus.Aborted), DeckStatus.Incomplete],
    ['确认后还没开始做', true, 5, 0, run(DeckRunKind.Slides, AttemptStatus.Failed), DeckStatus.Incomplete],
    ['全部做完', true, 5, 5, run(DeckRunKind.Slides, AttemptStatus.Succeeded), DeckStatus.Ready],
    ['修改失败仍是做完的', true, 5, 5, run(DeckRunKind.Slides, AttemptStatus.Failed), DeckStatus.Ready],
  ])('%s', (_name, outlineConfirmed, slideCount, madeCount, latestRun, expected) => {
    expect(deckStatusOf({ outlineConfirmed, slideCount, madeCount, latestRun })).toBe(expected);
  });
});
