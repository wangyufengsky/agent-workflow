import { z } from 'zod';

/** Sub-codes of `KNOWLEDGE_CITATION_INVALID.details.problems[].code` (18 §6.2). */
export const CitationProblemCode = {
  OutsideProject: 'OUTSIDE_PROJECT',
  FileNotFound: 'FILE_NOT_FOUND',
  LineOutOfRange: 'LINE_OUT_OF_RANGE',
  RangeTooLong: 'RANGE_TOO_LONG',
  SourceNotSelected: 'SOURCE_NOT_SELECTED',
  UnknownConnection: 'UNKNOWN_CONNECTION',
  QueryNotReadonly: 'QUERY_NOT_READONLY',
  UnknownMarker: 'UNKNOWN_MARKER',
  UnusedCitation: 'UNUSED_CITATION',
} as const;
export type CitationProblemCode = (typeof CitationProblemCode)[keyof typeof CitationProblemCode];
export const citationProblemCodeSchema = z.enum(CitationProblemCode);

/** Hint returned to the model with each problem: how to fix the citation. */
export const CITATION_PROBLEM_HINT = {
  [CitationProblemCode.OutsideProject]:
    'Use a path relative to the repository root and cite only files inside the repository (not .git).',
  [CitationProblemCode.FileNotFound]: 'Check the path with glob or ls before citing it.',
  [CitationProblemCode.LineOutOfRange]:
    'Use the line numbers the read tool shows; start_line <= end_line <= details.lineCount.',
  [CitationProblemCode.RangeTooLong]: 'Cite only the lines that support the statement.',
  [CitationProblemCode.SourceNotSelected]: 'Cite only sources this question may use (see details.allowed).',
  [CitationProblemCode.UnknownConnection]: 'Use a connection name returned by db_list_connections.',
  [CitationProblemCode.QueryNotReadonly]: 'Cite one read-only statement: SELECT, SHOW, DESCRIBE or EXPLAIN.',
  [CitationProblemCode.UnknownMarker]: 'Markers are [1], [2] … matching the position of a citation in citations.',
  [CitationProblemCode.UnusedCitation]: 'Mark the citation in the answer where it supports a statement, or remove it.',
} as const satisfies Record<CitationProblemCode, string>;

export const citationProblemSchema = z.object({
  code: citationProblemCodeSchema,
  /** The citation's number (its position in `citations`, from 1), or the unknown marker's number. */
  citation: z.number().optional(),
  message: z.string(),
  hint: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type CitationProblem = z.infer<typeof citationProblemSchema>;
