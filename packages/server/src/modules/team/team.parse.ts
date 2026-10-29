import { GIT_COMMIT_IDENTITY, TEAM_AI_COAUTHOR_PATTERNS, TEAM_REQUESTED_BY_TRAILER, TeamWorkType } from '@aw/shared';
import { parseNumstat } from '../git/index.ts';

/**
 * Each commit starts with RS; fields end with NUL (author after `.mailmap`, git's own trailer parsing); the
 * numstat follows (`-z`). Subjects and bodies never hold NUL or RS.
 */
export const TEAM_LOG_FORMAT = '%x1e%H%x00%aN%x00%aE%x00%at%x00%s%x00%(trailers:only,unfold)%x00%b%x00';
const HEADER_FIELDS = 7;

export type CommitFile = { path: string; added: number | null; deleted: number | null };

/** What 33 §7.1 keeps of a commit. */
export type CommitFacts = {
  sha: string;
  authorEmail: string;
  authorName: string;
  authoredAt: number;
  subject: string;
  aiTask: boolean;
  aiCoauthor: boolean;
  requestedBy: { email: string; name: string } | null;
  revertsSha: string | null;
  files: CommitFile[];
};

const PERSON = /^(.*?)\s*<([^>]+)>\s*$/;
const REVERTS = /This reverts commit ([0-9a-f]{40,64})/;

/** `Key: value` lines as `git log %(trailers:only,unfold)` prints them. */
function trailers(text: string): { key: string; value: string }[] {
  return text
    .split('\n')
    .map((line) => /^([^:\s]+):\s*(.*)$/.exec(line))
    .flatMap((m) => (m?.[1] === undefined || m[2] === undefined ? [] : [{ key: m[1].toLowerCase(), value: m[2] }]));
}

function requestedBy(found: { key: string; value: string }[]): CommitFacts['requestedBy'] {
  const value = found.find((t) => t.key === TEAM_REQUESTED_BY_TRAILER.toLowerCase())?.value;
  const person = value === undefined ? null : PERSON.exec(value);
  if (person?.[1] === undefined || person[2] === undefined) return null;
  return { name: person[1], email: person[2].toLowerCase() };
}

const isAiCoauthor = (found: { key: string; value: string }[]) =>
  found.some(
    (t) => t.key === 'co-authored-by' && TEAM_AI_COAUTHOR_PATTERNS.some((p) => t.value.toLowerCase().includes(p)),
  );

/** `git log --format=<TEAM_LOG_FORMAT> --numstat -z`. */
export function parseTeamLog(output: string): CommitFacts[] {
  return output
    .split('\x1e')
    .filter((record) => record !== '')
    .map((record) => {
      const fields = record.split('\0');
      const [sha, authorName, authorEmail, authoredAt, subject, trailerText, body] = fields;
      if (
        sha === undefined ||
        authorName === undefined ||
        authorEmail === undefined ||
        authoredAt === undefined ||
        subject === undefined ||
        trailerText === undefined ||
        body === undefined
      ) {
        throw new Error(`Unexpected git log record ${record}`);
      }
      // After the header: NUL and a newline, then the numstat; nothing for a commit that changes no file.
      const numstat = fields
        .slice(HEADER_FIELDS)
        .join('\0')
        .replace(/^\0?\n?/, '');
      const found = trailers(trailerText);
      const email = authorEmail.toLowerCase();
      const starter = requestedBy(found);
      return {
        sha,
        authorEmail: email,
        authorName,
        authoredAt: Number(authoredAt) * 1000,
        subject,
        // Only this app writes the starter trailer: with `git.commitIdentity` set its commits have another author (D227).
        aiTask: email === GIT_COMMIT_IDENTITY.email || starter !== null,
        aiCoauthor: isAiCoauthor(found),
        requestedBy: starter,
        revertsSha: REVERTS.exec(body)?.[1] ?? null,
        files: [...parseNumstat(numstat)].map(([path, c]) => ({ path, added: c.additions, deleted: c.deletions })),
      };
    });
}

/** Subject prefixes by kind of work (33 §3.3): conventional commit types, then a few Chinese words. */
const WORK_PREFIXES: [TeamWorkType, string[]][] = [
  [TeamWorkType.Feature, ['feat', 'feature']],
  [TeamWorkType.Fix, ['fix', 'bugfix', 'hotfix']],
  [TeamWorkType.Test, ['test', 'tests']],
  [TeamWorkType.Refactor, ['refactor', 'perf']],
  [TeamWorkType.Docs, ['docs', 'doc']],
  [TeamWorkType.Chore, ['build', 'ci', 'chore', 'style', 'revert']],
];
const CHINESE_PREFIXES: [TeamWorkType, string[]][] = [
  [TeamWorkType.Feature, ['新增', '添加', '实现']],
  [TeamWorkType.Fix, ['修复', '修正']],
  [TeamWorkType.Test, ['测试']],
  [TeamWorkType.Refactor, ['重构', '优化']],
  [TeamWorkType.Docs, ['文档']],
];
const CONVENTIONAL = /^([a-z]+)(\([^)]*\))?!?:/i;

export function classifyWork(subject: string): TeamWorkType {
  const type = CONVENTIONAL.exec(subject.trim())?.[1]?.toLowerCase();
  if (type !== undefined) return WORK_PREFIXES.find(([, words]) => words.includes(type))?.[0] ?? TeamWorkType.Other;
  // `Revert "..."` is what `git revert` writes.
  if (subject.startsWith('Revert "')) return TeamWorkType.Chore;
  const head = subject.trim();
  return CHINESE_PREFIXES.find(([, words]) => words.some((w) => head.startsWith(w)))?.[0] ?? TeamWorkType.Other;
}
