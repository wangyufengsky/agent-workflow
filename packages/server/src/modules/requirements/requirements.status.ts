import { RequirementConclusion, RequirementDisplayStatus, type RequirementResultDTO } from '@aw/shared';

/** What the task's results are judged against: the checklist version, and the commit when it is known. */
export type RequirementBaseline = { revisionId: string; commitSha: string | null };

const STATUS_OF = {
  [RequirementConclusion.Pass]: RequirementDisplayStatus.Passed,
  [RequirementConclusion.Fail]: RequirementDisplayStatus.Failed,
  [RequirementConclusion.Unverified]: RequirementDisplayStatus.Unverified,
  [RequirementConclusion.Waive]: RequirementDisplayStatus.Waived,
} as const satisfies Record<RequirementConclusion, RequirementDisplayStatus>;

/**
 * An item's state (31 §3) from its results in the order they were given: the latest decides, whoever gave it. A
 * conclusion about another version or another commit no longer says anything about the current work (`stale`). An
 * unknown commit (the worktree is gone) compares the version only.
 */
export function displayStatus(
  results: readonly RequirementResultDTO[],
  baseline: RequirementBaseline,
): { status: RequirementDisplayStatus; latest: RequirementResultDTO | null } {
  const latest = results.at(-1);
  if (latest === undefined) return { status: RequirementDisplayStatus.Unverified, latest: null };
  const current =
    latest.revisionId === baseline.revisionId &&
    (baseline.commitSha === null || latest.commitSha === baseline.commitSha);
  if (!current) return { status: RequirementDisplayStatus.Stale, latest };
  return { status: STATUS_OF[latest.conclusion], latest };
}
