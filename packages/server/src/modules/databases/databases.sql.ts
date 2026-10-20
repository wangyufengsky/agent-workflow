import { AppError, ErrorCode } from '@aw/shared';

/** First keywords of the statements `db_query` runs (12 §6.11). */
const READ_ONLY_FIRST_KEYWORDS: ReadonlySet<string> = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN']);

/**
 * Clauses of a read-only statement that still write or lock: `SELECT … INTO OUTFILE` writes a server file and `INTO`
 * sets variables; locking reads hold row locks. Matched on the statement with strings and comments removed.
 */
const FORBIDDEN_CLAUSES: readonly RegExp[] = [
  /\bINTO\b/i,
  /\bFOR\s+(UPDATE|SHARE)\b/i,
  /\bLOCK\s+IN\s+SHARE\s+MODE\b/i,
];

const reject = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError(ErrorCode.DbQueryRejected, reason, details);

/**
 * The statement's code with string literals, quoted identifiers and comments blanked out, so keywords and semicolons
 * inside them do not count. MySQL executes the content of `/*! … *\/` comments, so those are rejected.
 */
function codeOf(sql: string): string {
  let code = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const next = sql[i + 1] ?? '';
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && c !== '`') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j += 1;
      }
      if (j >= sql.length) throw reject('Unterminated quoted text');
      code += ' ? ';
      i = j + 1;
    } else if (c === '/' && next === '*') {
      if (sql[i + 2] === '!') throw reject('Executable comments are not allowed');
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw reject('Unterminated comment');
      code += ' ';
      i = end + 2;
    } else if (c === '#' || (c === '-' && next === '-' && /\s/.test(sql[i + 2] ?? ' '))) {
      const end = sql.indexOf('\n', i);
      code += ' ';
      i = end === -1 ? sql.length : end + 1;
    } else {
      code += c;
      i += 1;
    }
  }
  return code;
}

/**
 * The statement-level half of the read-only guarantee (12 §6.11): exactly one statement (a trailing semicolon is
 * allowed), starting with SELECT / SHOW / DESCRIBE / EXPLAIN, without clauses that write or lock. The driver adds the
 * other half: no multi-statement support and a READ ONLY transaction with row and time limits.
 */
export function assertReadOnlySql(sql: string): void {
  const code = codeOf(sql).trim().replace(/;\s*$/, '');
  if (code.includes(';')) throw reject('Only one statement is allowed');
  const first = /^[\s(]*([A-Za-z]+)/.exec(code)?.[1]?.toUpperCase();
  if (first === undefined || !READ_ONLY_FIRST_KEYWORDS.has(first)) {
    throw reject('Only SELECT, SHOW, DESCRIBE and EXPLAIN statements are allowed', { keyword: first ?? null });
  }
  const clause = FORBIDDEN_CLAUSES.find((pattern) => pattern.test(code));
  if (clause !== undefined) throw reject('The statement writes or locks', { clause: clause.source });
}
