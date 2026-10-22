import { type RequiredStep, RequiredStepPosition } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { END, START } from '../../canvas/layout.ts';
import { addRequired, insertPosition, insertRequired, PLANNED, shapeDependencies } from './required-steps.ts';

const step = (key: string, position?: RequiredStep['position']): RequiredStep => ({
  key,
  title: key,
  roleKey: 'tester',
  instructions: key,
  dependsOn: [],
  ...(position === undefined ? {} : { position }),
});
const shape = [step('baseline', RequiredStepPosition.First), step('docs'), step('verify', RequiredStepPosition.Last)];
const blank = { title: '新步骤', roleKey: 'tester', instructions: '' };
const order = (steps: readonly RequiredStep[]) => steps.map((s) => `${s.key}:${s.position ?? '-'}`);

describe('AI 规划流程的形状', () => {
  it('最先的步骤串在规划步骤之前，不限位置的与规划步骤并列，最后的串在之后', () => {
    const { steps, planned } = shapeDependencies(shape);
    expect(planned).toEqual(['baseline']);
    expect(Object.fromEntries(steps)).toEqual({ baseline: [], docs: ['baseline'], verify: [PLANNED, 'docs'] });
  });

  it('没有最先或最后的步骤时，规划步骤前后的 + 加上它，并按画布上的位置排列', () => {
    const middle = [step('docs')];
    expect([insertPosition(middle, START, PLANNED), insertPosition(middle, PLANNED, END)]).toEqual([
      RequiredStepPosition.First,
      RequiredStepPosition.Last,
    ]);
    expect(order(insertRequired(middle, START, PLANNED, blank).steps)).toEqual(['required_2:first', 'docs:-']);
    expect(order(insertRequired(middle, PLANNED, END, blank).steps)).toEqual(['docs:-', 'required_2:last']);
    expect(order(addRequired(shape, blank).steps)).toEqual(['baseline:first', 'docs:-', 'required_4:-', 'verify:last']);
  });

  it('已有最先（最后）的步骤时它两侧没有 +：第二个最先（最后）的步骤没有计划能满足', () => {
    expect([
      insertPosition(shape, START, 'baseline'),
      insertPosition(shape, 'baseline', PLANNED),
      insertPosition(shape, PLANNED, 'verify'),
      insertPosition(shape, 'verify', END),
      insertPosition(shape, 'baseline', 'docs'),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
