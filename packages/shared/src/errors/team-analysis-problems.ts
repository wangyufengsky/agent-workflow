/** Sub-codes of `TEAM_ANALYSIS_INVALID.details.problems[].code` (33 §6.6). */
export const TeamAnalysisProblemCode = {
  CommitNotInPeriod: 'COMMIT_NOT_IN_PERIOD',
  CommitNotSampled: 'COMMIT_NOT_SAMPLED',
  PathNotInCommit: 'PATH_NOT_IN_COMMIT',
  LineOutOfRange: 'LINE_OUT_OF_RANGE',
} as const;
export type TeamAnalysisProblemCode = (typeof TeamAnalysisProblemCode)[keyof typeof TeamAnalysisProblemCode];

/** Hint returned to the model with each problem: how to fix that part of the analysis. */
export const TEAM_ANALYSIS_PROBLEM_HINT = {
  [TeamAnalysisProblemCode.CommitNotInPeriod]:
    "Cite only full SHAs from the commit list of your first message: the member's commits in the period.",
  [TeamAnalysisProblemCode.CommitNotSampled]:
    'Report findings only on the sampled commits your first message names (details.sampled lists them).',
  [TeamAnalysisProblemCode.PathNotInCommit]: 'Use a path the commit changed, as `git show --stat <sha>` shows it.',
  [TeamAnalysisProblemCode.LineOutOfRange]:
    'Use a line number of the file in the commit (new) or in its parent (old); line <= end_line.',
} as const satisfies Record<TeamAnalysisProblemCode, string>;
