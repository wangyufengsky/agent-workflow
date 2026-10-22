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

  it('规划步骤之前的 + 加最先的步骤，之后的加最后的步骤，并按画布上的位置排列', () => {
    expect([insertPosition(shape, START, 'baseline'), insertPosition(shape, 'verify', END)]).toEqual([
      RequiredStepPosition.First,
      RequiredStepPosition.Last,
    ]);
    expect(insertPosition(shape, 'baseline', 'docs')).toBeUndefined();
    expect(order(insertRequired(shape, 'baseline', PLANNED, blank).steps)).toEqual([
      'baseline:first',
      'required_4:first',
      'docs:-',
      'verify:last',
    ]);
    expect(order(insertRequired(shape, PLANNED, 'verify', blank).steps)).toEqual([
      'baseline:first',
      'docs:-',
      'required_4:last',
      'verify:last',
    ]);
    expect(order(addRequired(shape, blank).steps)).toEqual(['baseline:first', 'docs:-', 'required_4:-', 'verify:last']);
  });
});
