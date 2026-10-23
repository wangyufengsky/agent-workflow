import { readFile } from 'node:fs/promises';
import {
  AppError,
  CITATION_PROBLEM_HINT,
  type CitationDTO,
  type CitationProblem,
  CitationProblemCode,
  type CitationSourceDTO,
  CitationType,
  citationMarkers,
  classifySource,
  type DbType,
  ErrorCode,
  KNOWLEDGE_CITATION_MAX_LINES,
  KNOWLEDGE_EXCERPT_MAX_CHARS,
  KNOWLEDGE_SOURCE_CONTEXT_LINES,
  KnowledgeSourceKind,
  type KnowledgeSources,
  type SubmitAnswerInput,
  type SubmittedCitation,
} from '@aw/shared';
import { linesOf, locateRepoFile, RepoFileProblem } from '../../core/repo-files.ts';
import { assertReadOnlySql } from '../databases/index.ts';

type Problem = Omit<CitationProblem, 'hint'>;
type RepoFile = { relativePath: string; lines: string[] };
/** Why a path cannot be read as a repository file. */
type Unreadable = typeof CitationProblemCode.OutsideProject | typeof CitationProblemCode.FileNotFound;

/**
 * Reads a file the model or a stored citation names, only if it is a regular file inside the repository (06 §11):
 * relative, not escaping through `..` or a symbolic link, not in `.git` (18 §6.2).
 */
async function readRepoFile(repoPath: string, path: string): Promise<RepoFile | Unreadable> {
  const file = await locateRepoFile(repoPath, path);
  if (file === RepoFileProblem.Outside) return CitationProblemCode.OutsideProject;
  if (file === RepoFileProblem.Missing) return CitationProblemCode.FileNotFound;
  return { relativePath: file.relativePath, lines: linesOf(await readFile(file.real, 'utf8')) };
}

const excerptOf = (lines: readonly string[], start: number, end: number) =>
  lines
    .slice(start - 1, end)
    .join('\n')
    .slice(0, KNOWLEDGE_EXCERPT_MAX_CHARS);

/** `connections`: the project's database connections by name, with their type (its SQL dialect, 24 §4). */
export type CitationScope = { repoPath: string; sources: KnowledgeSources; connections: ReadonlyMap<string, DbType> };

async function checkCitation(
  citation: SubmittedCitation,
  scope: CitationScope,
  report: (code: CitationProblemCode, message: string, details?: Record<string, unknown>) => void,
): Promise<CitationDTO | undefined> {
  const allowed = Object.values(KnowledgeSourceKind).filter((kind) => scope.sources[kind]);
  const notSelected = (kind: KnowledgeSourceKind) =>
    report(CitationProblemCode.SourceNotSelected, `${kind} is not a source of this question`, { kind, allowed });
  switch (citation.type) {
    case CitationType.File: {
      const file = await readRepoFile(scope.repoPath, citation.path);
      if (typeof file === 'string') {
        report(file, `${citation.path} is not a file inside the repository`, { path: citation.path });
        return undefined;
      }
      const { start_line: start, end_line: end } = citation;
      const lineCount = file.lines.length;
      if (start > end || end > lineCount) {
        report(CitationProblemCode.LineOutOfRange, `Lines ${start}-${end} are not in ${file.relativePath}`, {
          lineCount,
        });
        return undefined;
      }
      if (end - start + 1 > KNOWLEDGE_CITATION_MAX_LINES) {
        report(
          CitationProblemCode.RangeTooLong,
          `Lines ${start}-${end} span more than ${KNOWLEDGE_CITATION_MAX_LINES}`,
          {
            maxLines: KNOWLEDGE_CITATION_MAX_LINES,
          },
        );
        return undefined;
      }
      const source = classifySource(file.relativePath);
      if (!scope.sources[source]) {
        notSelected(source);
        return undefined;
      }
      return {
        type: CitationType.File,
        path: file.relativePath,
        startLine: start,
        endLine: end,
        source,
        excerpt: excerptOf(file.lines, start, end),
      };
    }
    case CitationType.Database: {
      if (!scope.sources.database) {
        notSelected(KnowledgeSourceKind.Database);
        return undefined;
      }
      const type = scope.connections.get(citation.connection);
      if (type === undefined) {
        report(CitationProblemCode.UnknownConnection, `No connection ${citation.connection}`, {
          connections: [...scope.connections.keys()],
        });
        return undefined;
      }
      try {
        assertReadOnlySql(citation.sql, type);
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== ErrorCode.DbQueryRejected) throw err;
        report(CitationProblemCode.QueryNotReadonly, err.message);
        return undefined;
      }
      return { type: CitationType.Database, connection: citation.connection, sql: citation.sql };
    }
    case CitationType.Web:
      if (!scope.sources.web) {
        notSelected(KnowledgeSourceKind.Web);
        return undefined;
      }
      return { type: CitationType.Web, url: citation.url, title: citation.title ?? null };
  }
}

/**
 * Checks an answer's citations against the repository, the question's sources and the answer's markers (18 §6.2):
 * every problem at once, each with its hint, or the citations to store. Nothing is dropped silently.
 */
export async function validateCitations(input: SubmitAnswerInput, scope: CitationScope): Promise<CitationDTO[]> {
  const problems: Problem[] = [];
  const marked = new Set(citationMarkers(input.answer).map((m) => m.n));
  for (const n of marked) {
    if (n < 1 || n > input.citations.length) {
      problems.push({ code: CitationProblemCode.UnknownMarker, citation: n, message: `[${n}] has no citation` });
    }
  }
  const checked = await Promise.all(
    input.citations.map(async (citation, i) => {
      const n = i + 1;
      const report = (code: CitationProblemCode, message: string, details?: Record<string, unknown>) =>
        problems.push({ code, citation: n, message, ...(details === undefined ? {} : { details }) });
      if (!marked.has(n)) report(CitationProblemCode.UnusedCitation, `Citation ${n} is not marked in the answer`);
      return checkCitation(citation, scope, report);
    }),
  );
  if (problems.length > 0) {
    problems.sort((a, b) => (a.citation ?? 0) - (b.citation ?? 0));
    throw new AppError(ErrorCode.KnowledgeCitationInvalid, 'Citations are invalid', {
      problems: problems.map((p) => ({ ...p, hint: CITATION_PROBLEM_HINT[p.code] })),
    });
  }
  return checked.filter((c) => c !== undefined);
}

/**
 * The cited lines with `KNOWLEDGE_SOURCE_CONTEXT_LINES` around them (18 §6.3), read again through the repository
 * check: the file may have been deleted or replaced since.
 */
export async function readCitedFile(
  repoPath: string,
  citation: Extract<CitationDTO, { type: typeof CitationType.File }>,
): Promise<CitationSourceDTO> {
  const file = await readRepoFile(repoPath, citation.path);
  if (typeof file === 'string') {
    throw new AppError(ErrorCode.KnowledgeSourceUnavailable, `${citation.path} is no longer in the repository`, {
      path: citation.path,
      reason: file,
    });
  }
  const lineCount = file.lines.length;
  const firstLine = Math.max(1, Math.min(citation.startLine, lineCount) - KNOWLEDGE_SOURCE_CONTEXT_LINES);
  const lastLine = Math.min(lineCount, citation.endLine + KNOWLEDGE_SOURCE_CONTEXT_LINES);
  return {
    type: CitationType.File,
    path: citation.path,
    startLine: citation.startLine,
    endLine: citation.endLine,
    firstLine,
    lines: file.lines.slice(firstLine - 1, lastLine),
    lineCount,
    changed: excerptOf(file.lines, citation.startLine, citation.endLine) !== citation.excerpt,
  };
}
