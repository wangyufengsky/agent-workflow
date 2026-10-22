/** Sub-codes of `GIT_REVIEW_FINDINGS_INVALID.details.problems[].code` (27 §4.4). */
export const FindingProblemCode = {
  PathNotInDiff: 'PATH_NOT_IN_DIFF',
  LineOutOfRange: 'LINE_OUT_OF_RANGE',
} as const;
export type FindingProblemCode = (typeof FindingProblemCode)[keyof typeof FindingProblemCode];

/** Hint returned to the model with each problem: how to fix the finding. */
export const FINDING_PROBLEM_HINT = {
  [FindingProblemCode.PathNotInDiff]:
    'Report findings only on files of the reviewed diff (details.files lists them), with the path git diff shows.',
  [FindingProblemCode.LineOutOfRange]:
    'Use a line number of the file on the side you name (new: the reviewed version, old: the version before); line <= end_line.',
} as const satisfies Record<FindingProblemCode, string>;
