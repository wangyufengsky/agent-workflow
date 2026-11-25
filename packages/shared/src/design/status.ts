import { DesignRunKind, DesignStatus } from '../enums/design.ts';
import { ACTIVE_ATTEMPT_STATUSES, AttemptStatus } from '../enums/task.ts';

const activeStatusByRun = {
  [DesignRunKind.Outline]: DesignStatus.Outlining,
  [DesignRunKind.Generate]: DesignStatus.Generating,
  [DesignRunKind.Revise]: DesignStatus.Generating,
  [DesignRunKind.Review]: DesignStatus.Reviewing,
} satisfies Record<DesignRunKind, DesignStatus>;

export type DesignStatusInput = {
  outlineConfirmed: boolean;
  /** 确认后只统计选中的章节。 */
  totalSections: number;
  doneSections: number;
  latestRun: { kind: DesignRunKind; status: AttemptStatus } | null;
};

/** 设计不储存单独的状态，由最近一次尝试和已完成的选中章节推导（44 §4.3）。 */
export function designStatusOf({
  outlineConfirmed,
  totalSections,
  doneSections,
  latestRun,
}: DesignStatusInput): DesignStatus {
  if (latestRun !== null && ACTIVE_ATTEMPT_STATUSES.includes(latestRun.status)) {
    return activeStatusByRun[latestRun.kind];
  }
  if (!outlineConfirmed) {
    return latestRun?.kind === DesignRunKind.Outline && latestRun.status === AttemptStatus.Failed
      ? DesignStatus.Failed
      : DesignStatus.OutlineReady;
  }
  return doneSections < totalSections ? DesignStatus.Incomplete : DesignStatus.Ready;
}
