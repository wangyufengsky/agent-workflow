/** The team page (33). */

/** Days a custom period may span (33 §4.1). */
export const TEAM_MAX_DAYS = 731;
/** Buckets a trend may have; only day buckets of a long period reach it (33 §4.2). */
export const TEAM_MAX_BUCKETS = 120;
/** A commit changing more counted lines than this has its lines left out; it still counts as a commit (33 §2.4). */
export const TEAM_HUGE_COMMIT_LINES = 5000;
/** Directories listed by changed lines (33 §3.1). */
export const TEAM_TOP_DIRECTORIES = 10;
/** Members drawn one by one in the team trend; the rest are summed as「其他」 (33 §5.2). */
export const TEAM_TREND_MEMBERS = 8;

/** Files whose lines are not counted unless the project says otherwise (33 §2.4). */
export const TEAM_DEFAULT_EXCLUDE_GLOBS = [
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/vendor/**',
  '**/node_modules/**',
  '**/*.min.js',
  '**/*.map',
  '**/*.snap',
] as const;

/** Test files, for the share of commits that change tests with the code (33 §3.2). */
export const TEAM_DEFAULT_TEST_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/*_test.go',
  '**/test_*.py',
] as const;

/**
 * The trailer this app's task commits name who started the task with (D130): `Name <email>` from the project
 * repository's Git config when the commit is made.
 */
export const TEAM_REQUESTED_BY_TRAILER = 'Agent-Workflow-Requested-By';

/** A task commit's message with the trailer naming who started it; unchanged without a configured identity. */
export function withRequestedBy(message: string, starter: { name: string; email: string } | null): string {
  return starter === null ? message : `${message}\n\n${TEAM_REQUESTED_BY_TRAILER}: ${starter.name} <${starter.email}>`;
}

/** `Co-Authored-By` names or addresses that mark another AI tool's commit (33 §2.5); matched case-blind. */
export const TEAM_AI_COAUTHOR_PATTERNS = [
  'claude',
  'anthropic',
  'copilot',
  'cursor',
  'codex',
  'openai',
  'gemini',
  'devin',
  'aider',
  'windsurf',
  'codeium',
] as const;
