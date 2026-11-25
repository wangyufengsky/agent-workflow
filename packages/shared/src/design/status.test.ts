import { describe, expect, it } from 'vitest';
import { DesignRunKind, DesignStatus } from '../enums/design.ts';
import { AttemptStatus } from '../enums/task.ts';
import { type DesignStatusInput, designStatusOf } from './status.ts';

const draft: DesignStatusInput = {
  outlineConfirmed: false,
  totalSections: 2,
  doneSections: 0,
  latestRun: null,
};
const complete: DesignStatusInput = { ...draft, outlineConfirmed: true, doneSections: 2 };

describe('designStatusOf', () => {
  it('distinguishes a program outline, a queued AI revision and a failed revision', () => {
    expect(designStatusOf(draft)).toBe(DesignStatus.OutlineReady);
    const kind = DesignRunKind.Outline;
    expect(designStatusOf({ ...draft, latestRun: { kind, status: AttemptStatus.Queued } })).toBe(
      DesignStatus.Outlining,
    );
    expect(designStatusOf({ ...draft, latestRun: { kind, status: AttemptStatus.Failed } })).toBe(DesignStatus.Failed);
  });

  it('shows a partial run as incomplete after an interruption', () => {
    const partial = { ...complete, doneSections: 1 };
    const kind = DesignRunKind.Generate;
    expect(designStatusOf({ ...partial, latestRun: { kind, status: AttemptStatus.Running } })).toBe(
      DesignStatus.Generating,
    );
    expect(designStatusOf({ ...partial, latestRun: { kind, status: AttemptStatus.Interrupted } })).toBe(
      DesignStatus.Incomplete,
    );
  });

  it('retains ready status after a failed rewrite or optional review', () => {
    expect(designStatusOf(complete)).toBe(DesignStatus.Ready);
    expect(
      designStatusOf({ ...complete, latestRun: { kind: DesignRunKind.Revise, status: AttemptStatus.Failed } }),
    ).toBe(DesignStatus.Ready);
    const review = { ...complete, latestRun: { kind: DesignRunKind.Review, status: AttemptStatus.Starting } };
    expect(designStatusOf(review)).toBe(DesignStatus.Reviewing);
    expect(designStatusOf({ ...review, latestRun: { ...review.latestRun, status: AttemptStatus.Failed } })).toBe(
      DesignStatus.Ready,
    );
  });
});
