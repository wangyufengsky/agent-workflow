/** One line of a hunk; line numbers are null on the side the line does not exist on. */
export type DiffLine = { kind: 'context' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type ParsedDiff = { binary: boolean; hunks: DiffHunk[] };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A single file's unified diff (`git diff -- <path>`) as hunks of numbered lines. */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let binary = false;
  let current: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split('\n')) {
    const header = HUNK.exec(line);
    if (header !== null) {
      current = { header: line, lines: [] };
      hunks.push(current);
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    if (current === undefined) {
      if (line.startsWith('Binary files ')) binary = true;
      continue;
    }
    const sign = line.charAt(0);
    const text = line.slice(1);
    if (sign === ' ') current.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text });
    else if (sign === '-') current.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text });
    else if (sign === '+') current.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text });
    // `\ No newline at end of file` and the empty string after the final newline carry no line.
  }
  return { binary, hunks };
}

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/** Side-by-side rows: context on both sides, each run of deletions paired with the additions that follow it. */
export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    }
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === 'del') {
      if (adds.length > 0) flush();
      dels.push(line);
    } else if (line.kind === 'add') adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}
