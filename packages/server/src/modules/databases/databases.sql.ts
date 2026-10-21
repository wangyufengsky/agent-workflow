import { AppError, DB_READ_ONLY_STATEMENTS, DbType, ErrorCode } from '@aw/shared';

/** How a database family writes SQL: quoting, comments, and which statements are read-only (24 §4). */
const SqlDialect = { Mysql: 'mysql', Postgres: 'postgres', Tsql: 'tsql' } as const;
type SqlDialect = (typeof SqlDialect)[keyof typeof SqlDialect];

const SQL_DIALECT = {
  [DbType.Mysql]: SqlDialect.Mysql,
  [DbType.Goldendb]: SqlDialect.Mysql,
  [DbType.Postgresql]: SqlDialect.Postgres,
  [DbType.Opengauss]: SqlDialect.Postgres,
  [DbType.Sqlserver]: SqlDialect.Tsql,
} as const satisfies Record<DbType, SqlDialect>;

/**
 * T-SQL words that write, run code, change the session or the transaction, or lock (24 §4.3). T-SQL needs no
 * semicolon between statements, so a second statement can only be found by its keyword; most of these are reserved
 * words, which an identifier can use only quoted (and quoted text is blanked before matching).
 */
const TSQL_FORBIDDEN_WORDS = [
  'INTO',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'TRUNCATE',
  'DROP',
  'CREATE',
  'ALTER',
  'ADD',
  'EXEC',
  'EXECUTE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVE',
  'TRAN',
  'TRANSACTION',
  'GRANT',
  'REVOKE',
  'DENY',
  'USE',
  'SET',
  'DECLARE',
  'KILL',
  'SHUTDOWN',
  'BACKUP',
  'RESTORE',
  'DBCC',
  'BULK',
  'RECONFIGURE',
  'CHECKPOINT',
  'SETUSER',
  'REVERT',
  'OPENROWSET',
  'OPENQUERY',
  'OPENDATASOURCE',
  'WRITETEXT',
  'UPDATETEXT',
  'RECEIVE',
  'SEND',
  'CONVERSATION',
  'ENABLE',
  'DISABLE',
  'UPDLOCK',
  'XLOCK',
  'HOLDLOCK',
  'TABLOCK',
  'TABLOCKX',
] as const;

/** The first keyword a statement may have comes from `DB_READ_ONLY_STATEMENTS`, by connection type. */
type DialectRules = {
  /** Clauses that still write or lock, matched on the statement with quoted text and comments removed. */
  forbidden: readonly RegExp[];
  /** Opening character of quoted text (strings and identifiers) → its closing character. */
  quotes: Readonly<Record<string, string>>;
  /** Quotes inside which a backslash escapes the next character. */
  backslashQuotes: string;
  /** Whether `/* … *\/` comments nest. */
  nestedComments: boolean;
  isLineComment(sql: string, i: number): boolean;
};

const RULES: Record<SqlDialect, DialectRules> = {
  [SqlDialect.Mysql]: {
    // `SELECT … INTO OUTFILE` writes a server file and `INTO` sets variables; locking reads hold row locks.
    forbidden: [/\bINTO\b/i, /\bFOR\s+(UPDATE|SHARE)\b/i, /\bLOCK\s+IN\s+SHARE\s+MODE\b/i],
    quotes: { "'": "'", '"': '"', '`': '`' },
    backslashQuotes: `'"`,
    nestedComments: false,
    // `--` starts a comment only when followed by whitespace.
    isLineComment: (sql, i) => sql[i] === '#' || (sql.startsWith('--', i) && /\s/.test(sql[i + 2] ?? ' ')),
  },
  [SqlDialect.Postgres]: {
    // `SELECT … INTO` creates a table.
    forbidden: [/\bINTO\b/i, /\bFOR\s+(NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b/i],
    quotes: { "'": "'", '"': '"' },
    // Only E'…' strings know backslash escapes; they are found by the `E` before the quote (`codeOf`).
    backslashQuotes: '',
    nestedComments: true,
    isLineComment: (sql, i) => sql.startsWith('--', i),
  },
  [SqlDialect.Tsql]: {
    forbidden: [new RegExp(`\\b(${TSQL_FORBIDDEN_WORDS.join('|')})\\b`, 'i')],
    quotes: { "'": "'", '"': '"', '[': ']' },
    backslashQuotes: '',
    nestedComments: true,
    isLineComment: (sql, i) => sql.startsWith('--', i),
  },
};

const reject = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError(ErrorCode.DbQueryRejected, reason, details);

/** Index after quoted text opened at `i`; a doubled closing character stands for itself. */
function quotedEnd(sql: string, i: number, close: string, backslash: boolean): number {
  let j = i + 1;
  while (j < sql.length) {
    if (backslash && sql[j] === '\\') j += 2;
    else if (sql[j] === close && sql[j + 1] === close) j += 2;
    else if (sql[j] === close) return j + 1;
    else j += 1;
  }
  throw reject('Unterminated quoted text');
}

/** Index after the `/* … *\/` comment opened at `i`. */
function blockCommentEnd(sql: string, i: number, nested: boolean): number {
  if (!nested) {
    const end = sql.indexOf('*/', i + 2);
    if (end === -1) throw reject('Unterminated comment');
    return end + 2;
  }
  let depth = 0;
  let j = i;
  while (j < sql.length) {
    if (sql.startsWith('/*', j)) {
      depth += 1;
      j += 2;
    } else if (sql.startsWith('*/', j)) {
      depth -= 1;
      j += 2;
      if (depth === 0) return j;
    } else j += 1;
  }
  throw reject('Unterminated comment');
}

/** PostgreSQL's `$tag$ … $tag$` string opened at `i`, or undefined (`$1` is a parameter, `a$b` an identifier). */
function dollarQuoteEnd(sql: string, i: number): number | undefined {
  if (/[\w$]/.test(sql[i - 1] ?? ' ')) return undefined;
  const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))?.[0];
  if (tag === undefined) return undefined;
  const end = sql.indexOf(tag, i + tag.length);
  if (end === -1) throw reject('Unterminated quoted text');
  return end + tag.length;
}

/**
 * The statement's code with quoted text and comments blanked out, so keywords and semicolons inside them do not count.
 * Line comments end at `\r` as well as `\n`: seeing more code than the server does only rejects more. MySQL executes
 * the content of `/*! … *\/` comments, so those are rejected.
 */
function codeOf(sql: string, dialect: SqlDialect): string {
  const rules = RULES[dialect];
  let code = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const close = rules.quotes[c];
    const dollarEnd = dialect === SqlDialect.Postgres && c === '$' ? dollarQuoteEnd(sql, i) : undefined;
    if (close !== undefined) {
      const escapeString = dialect === SqlDialect.Postgres && /(^|[^\w$])[Ee]$/.test(sql.slice(0, i));
      i = quotedEnd(sql, i, close, rules.backslashQuotes.includes(c) || (c === "'" && escapeString));
      code += ' ? ';
    } else if (dollarEnd !== undefined) {
      i = dollarEnd;
      code += ' ? ';
    } else if (sql.startsWith('/*', i)) {
      if (dialect === SqlDialect.Mysql && sql[i + 2] === '!') throw reject('Executable comments are not allowed');
      i = blockCommentEnd(sql, i, rules.nestedComments);
      code += ' ';
    } else if (rules.isLineComment(sql, i)) {
      const end = sql.slice(i).search(/[\r\n]/);
      i = end === -1 ? sql.length : i + end + 1;
      code += ' ';
    } else {
      code += c;
      i += 1;
    }
  }
  return code;
}

/**
 * The statement-level half of the read-only guarantee (12 §6.11, 24 §4): exactly one statement (a trailing semicolon
 * is allowed), starting with one of the dialect's read-only keywords, without clauses that write or lock. The driver
 * adds the other half: one statement per request, a read-only (or rolled back) transaction, row and time limits.
 */
export function assertReadOnlySql(sql: string, type: DbType): void {
  const dialect = SQL_DIALECT[type];
  const rules = RULES[dialect];
  const code = codeOf(sql, dialect).trim().replace(/;\s*$/, '');
  if (code.includes(';')) throw reject('Only one statement is allowed');
  const allowed: readonly string[] = DB_READ_ONLY_STATEMENTS[type];
  const first = /^[\s(]*([A-Za-z]+)/.exec(code)?.[1]?.toUpperCase();
  if (first === undefined || !allowed.includes(first)) {
    throw reject(`Only ${allowed.join(', ')} statements are allowed`, { keyword: first ?? null });
  }
  for (const pattern of rules.forbidden) {
    const clause = pattern.exec(code)?.[0];
    if (clause !== undefined) throw reject('The statement writes or locks', { clause });
  }
}
