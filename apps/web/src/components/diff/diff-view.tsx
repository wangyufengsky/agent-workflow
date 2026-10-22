import type { FileDiffDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '../../api/query-keys.ts';
import { DIFF_COPY as C } from '../../copy/diff.ts';
import styles from './diff.module.css';
import { highlight, type ThemedToken } from './highlight.ts';
import { type DiffHunk, type DiffLine, parseUnifiedDiff, toSplitRows } from './parse-diff.ts';

export type DiffMode = 'unified' | 'split';

/** A line an AI review found something on (27 §4.5): a dot by its number, coloured by severity. */
export type DiffMark = { line: number; side: 'new' | 'old'; severity: string; title: string };
/** A line to scroll to and highlight. */
export type DiffFocus = { line: number; side: 'new' | 'old' };

const atLine = (line: DiffLine, at: { line: number; side: 'new' | 'old' }) =>
  (at.side === 'old' ? line.oldNo : line.newNo) === at.line && (at.side === 'old' || line.kind !== 'del');

type Tokens = { old: Map<number, ThemedToken[]>; new: Map<number, ThemedToken[]> };

/** FNV-1a of the diff text: a short cache key for its highlighting. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/** Each side of the hunks is highlighted as one text, so a token spanning lines inside a hunk keeps its colour. */
async function tokenize(path: string, hunks: readonly DiffHunk[]): Promise<Tokens | null> {
  const lines = hunks.flatMap((h) => h.lines);
  const oldSide = lines.filter((l) => l.oldNo !== null);
  const newSide = lines.filter((l) => l.newNo !== null);
  const [oldTokens, newTokens] = await Promise.all([
    highlight(path, oldSide.map((l) => l.text).join('\n')),
    highlight(path, newSide.map((l) => l.text).join('\n')),
  ]);
  if (oldTokens === null || newTokens === null) return null;
  const byNumber = (side: DiffLine[], tokens: ThemedToken[][], key: 'oldNo' | 'newNo') =>
    new Map(side.flatMap((line, i) => (line[key] === null ? [] : [[line[key], tokens[i] ?? []] as const])));
  return { old: byNumber(oldSide, oldTokens, 'oldNo'), new: byNumber(newSide, newTokens, 'newNo') };
}

const FONT_ITALIC = 1;
const FONT_BOLD = 2;

function Code({ line, tokens }: { line: DiffLine; tokens: Tokens | null | undefined }) {
  const lineTokens =
    line.newNo !== null && line.kind !== 'del' ? tokens?.new.get(line.newNo) : tokens?.old.get(line.oldNo ?? -1);
  if (lineTokens === undefined) return <>{line.text}</>;
  return (
    <>
      {lineTokens.map((token, i) => (
        <span
          // Tokens of a line never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the token's identity
          key={i}
          style={{
            color: token.color,
            fontStyle: (token.fontStyle ?? 0) & FONT_ITALIC ? 'italic' : undefined,
            fontWeight: (token.fontStyle ?? 0) & FONT_BOLD ? 600 : undefined,
          }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

const SIGN = { context: ' ', add: '+', del: '−' } as const;

function UnifiedRows({
  hunk,
  tokens,
  marks,
  focus,
}: {
  hunk: DiffHunk;
  tokens: Tokens | null | undefined;
  marks: readonly DiffMark[];
  focus: DiffFocus | undefined;
}) {
  return hunk.lines.map((line) => {
    const mark = marks.find((m) => atLine(line, m));
    return (
      <tr
        key={`${line.oldNo}-${line.newNo}`}
        className={styles.line}
        data-kind={line.kind}
        data-mark={mark?.severity}
        data-focus={focus !== undefined && atLine(line, focus) ? true : undefined}
      >
        <td className={styles.no}>{line.oldNo}</td>
        <td className={styles.no} title={mark?.title}>
          {line.newNo}
        </td>
        <td className={styles.sign}>{SIGN[line.kind]}</td>
        <td className={styles.code}>
          <Code line={line} tokens={tokens} />
        </td>
      </tr>
    );
  });
}

function SplitRows({ hunk, tokens }: { hunk: DiffHunk; tokens: Tokens | null | undefined }) {
  return toSplitRows(hunk.lines).map(({ left, right }) => (
    <tr key={`${left?.oldNo}-${right?.newNo}`} className={styles.line}>
      <td className={styles.no}>{left?.oldNo}</td>
      <td className={styles.code} data-kind={left === null ? 'none' : left.kind}>
        {left !== null && <Code line={left} tokens={tokens} />}
      </td>
      <td className={styles.no}>{right?.newNo}</td>
      <td className={styles.code} data-kind={right === null ? 'none' : right.kind}>
        {right !== null && <Code line={right} tokens={tokens} />}
      </td>
    </tr>
  ));
}

/** One file's diff, unified or side by side, highlighted once the grammar is loaded (plain text until then). */
export function DiffView({
  file,
  mode,
  marks = [],
  focus,
}: {
  file: FileDiffDTO;
  mode: DiffMode;
  marks?: readonly DiffMark[] | undefined;
  focus?: DiffFocus | undefined;
}) {
  const parsed = useMemo(() => ('diff' in file ? parseUnifiedDiff(file.diff) : undefined), [file]);
  const scroller = useRef<HTMLDivElement>(null);
  // Scrolling is a side effect on the rendered rows, so it runs after they are in the document.
  useEffect(() => {
    if (focus === undefined) return;
    scroller.current?.querySelector('[data-focus]')?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const tokens = useQuery({
    queryKey: queryKeys.syntax(file.path, 'diff' in file ? digest(file.diff) : ''),
    queryFn: () => tokenize(file.path, parsed?.hunks ?? []),
    enabled: parsed !== undefined && parsed.hunks.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!('diff' in file)) return <p className="hint">{C.tooLarge(Math.ceil(file.size / 1024))}</p>;
  if (parsed === undefined || parsed.binary) return <p className="hint">{C.binary}</p>;
  if (parsed.hunks.length === 0) return <p className="hint">{C.empty}</p>;
  return (
    <div className={styles.scroll} ref={scroller} data-testid="diff-view">
      <table className={styles.table} data-mode={mode}>
        {/* Fixed layout takes column widths from the first row, which is a hunk header spanning all of them. */}
        <colgroup>
          {mode === 'unified' ? (
            <>
              <col className={styles.noCol} />
              <col className={styles.noCol} />
              <col className={styles.signCol} />
              <col />
            </>
          ) : (
            <>
              <col className={styles.noCol} />
              <col />
              <col className={styles.noCol} />
              <col />
            </>
          )}
        </colgroup>
        <tbody>
          {parsed.hunks.map((hunk) => (
            <Fragment key={hunk.header}>
              <tr className={styles.hunk}>
                <td colSpan={4}>{hunk.header}</td>
              </tr>
              {mode === 'unified' ? (
                <UnifiedRows hunk={hunk} tokens={tokens.data} marks={marks} focus={focus} />
              ) : (
                <SplitRows hunk={hunk} tokens={tokens.data} />
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
