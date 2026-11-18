import {
  type ArtifactAnchor,
  type ArtifactVersion,
  AttachmentFormat,
  columnName,
  getTaskArtifactOp,
  type RepositoryDocumentDraft,
  type SheetPreviewDTO,
  textLines,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type MouseEvent, type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { revealInPane, sizeReadingPane } from '../../components/reveal-in-pane.ts';
import { ARTIFACT_COPY } from '../../copy/artifacts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { DIFF_COPY } from '../../copy/diff.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { SheetView } from '../attachments/attachment-preview.tsx';
import styles from './artifact-workbench.module.css';

import { changedLines, type VersionChange } from './version-changes.ts';

const versionQuery = (task: string, version: string | undefined, sheet?: string) => ({
  queryKey: ['task-artifact-version', task, version, sheet],
  queryFn: () => callOperation(getTaskArtifactOp, { id: task, versionId: version ?? '', sheet }),
  enabled: version !== undefined,
  staleTime: Infinity,
});
function ChangeMark({ change }: { change: VersionChange | undefined }) {
  return change ? (
    <small className={styles.revision} data-kind={change.kind}>
      {DIFF_COPY.status[change.kind]}
      {change.before !== undefined && <span>{R.previous(change.before)}</span>}
    </small>
  ) : null;
}
export type ArtifactSelection = { anchor: ArtifactAnchor; quote: string };
type OnPick = (selection: ArtifactSelection) => void;

function blockAnchor(lines: string[], from: number, to: number): ArtifactSelection {
  const heading =
    lines
      .slice(0, from)
      .findLast((line) => /^#{1,6}\s+/.test(line))
      ?.replace(/^#+\s+/, '') ?? '';
  return {
    anchor: { kind: 'paragraph', lines: { from, to }, heading: heading.slice(0, 250) },
    quote: lines
      .slice(from - 1, to)
      .join('\n')
      .slice(0, 2400),
  };
}

function Content({
  source,
  changes,
  onPick,
}: {
  changes: Map<number, VersionChange>;
  source: string;
  onPick?: OnPick | undefined;
}) {
  const lines = textLines(source);
  function marker(from: number | undefined, to: number | undefined) {
    if (from === undefined || to === undefined) return null;
    let change: VersionChange | undefined;
    for (let i = from; i <= to && change === undefined; i++) change = changes.get(i);
    if (!change && !onPick) return null;
    return (
      <>
        <ChangeMark change={change} />
        {onPick && (
          <IconButton
            icon="edit"
            label={ARTIFACT_COPY.markLines(from, to)}
            onClick={() => onPick(blockAnchor(lines, from, to))}
            className={styles.mark}
          />
        )}
      </>
    );
  }
  const components: Components = {
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    p: ({ children, node }) => (
      <p>
        <span>{children}</span>
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </p>
    ),
    li: ({ children, node }) => (
      <li>
        {children}
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </li>
    ),
    table: ({ children }) => (
      <div className={styles.markdownTable}>
        <table>{children}</table>
      </div>
    ),
    tr: ({ children, node }) => {
      const position = node?.position;
      const control = marker(position?.start.line, position?.end.line);
      return (
        <tr>
          {children}
          {control === null ? null : <td className={styles.tableMark}>{control}</td>}
        </tr>
      );
    },
  };
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    const Heading = tag;
    components[tag] = ({ children, node }) => (
      <Heading>
        {children}
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </Heading>
    );
  }
  return (
    <article className={styles.paper}>
      <Markdown source={source} components={components} />
    </article>
  );
}

const PAGE_LINES = 180;

function Lines({
  focusLine,
  source,
  changes,
  onPick,
}: {
  focusLine?: number | undefined;
  changes: Map<number, VersionChange>;
  source: string;
  onPick?: OnPick | undefined;
}) {
  const targetPage = focusLine === undefined ? undefined : Math.floor((focusLine - 1) / PAGE_LINES) * PAGE_LINES;
  const [paging, setPaging] = useState({ targetPage, start: targetPage ?? 0 });
  if (paging.targetPage !== targetPage) setPaging({ targetPage, start: targetPage ?? paging.start });
  const { start } = paging;
  const setPage = (start: number) => setPaging({ targetPage, start });
  const [anchor, setAnchor] = useState<number>();
  const lines = textLines(source);
  const last = Math.min(start + PAGE_LINES, lines.length);
  function pick(line: number, shift: boolean) {
    if (onPick === undefined) return;
    if (!shift || anchor === undefined) setAnchor(line);
    const begin = shift ? (anchor ?? line) : line;
    const from = Math.min(begin, line);
    const to = Math.max(begin, line);
    onPick({
      anchor: { kind: 'lines', lines: { from, to } },
      quote: lines
        .slice(from - 1, to)
        .join('\n')
        .slice(0, 2400),
    });
  }
  return (
    <div className={styles.source}>
      <ol start={start + 1}>
        {lines.slice(start, last).map((line, index) => {
          const number = start + index + 1;
          return (
            <li key={number}>
              <span aria-hidden="true">{number}</span>
              {onPick ? (
                <button
                  type="button"
                  aria-label={ARTIFACT_COPY.markLines(number)}
                  onClick={(event) => pick(number, event.shiftKey)}
                >
                  {line || '\u00a0'}
                </button>
              ) : (
                <code>{line || '\u00a0'}</code>
              )}
              <ChangeMark change={changes.get(number)} />
            </li>
          );
        })}
      </ol>
      {lines.length > PAGE_LINES && (
        <div className="row wrap">
          <Button size="sm" disabled={start === 0} onClick={() => setPage(start - PAGE_LINES)}>
            {ARTIFACT_COPY.previousPage}
          </Button>
          <span className="hint">{ARTIFACT_COPY.pageLines(start + 1, last, lines.length)}</span>
          <Button size="sm" disabled={last === lines.length} onClick={() => setPage(start + PAGE_LINES)}>
            {ARTIFACT_COPY.nextPage}
          </Button>
        </div>
      )}
    </div>
  );
}

type Cell = { row: number; col: number; value: string };

const cellMap = (sheet: SheetPreviewDTO | null | undefined) =>
  new Map(sheet?.rows.flatMap((row) => row.cells.map((c) => [row.r + ':' + c.c, c] as const)));

function Workbook({
  data,
  before,
  onPick,
}: {
  before?: SheetPreviewDTO | null | undefined;
  data: SheetPreviewDTO;
  onPick?: OnPick | undefined;
}) {
  const [origin, setOrigin] = useState<Cell>();
  const [selected, setSelected] = useState<{ top: number; bottom: number; left: number; right: number }>();
  function pick(cell: Cell, event: MouseEvent) {
    if (!event.shiftKey || origin === undefined) setOrigin(cell);
    const start = event.shiftKey ? (origin ?? cell) : cell;
    const area = {
      top: Math.min(start.row, cell.row),
      bottom: Math.max(start.row, cell.row),
      left: Math.min(start.col, cell.col),
      right: Math.max(start.col, cell.col),
    };
    setSelected(area);
    const a = `${columnName(area.left)}${area.top}`;
    const b = `${columnName(area.right)}${area.bottom}`;
    const range = a === b ? a : `${a}:${b}`;
    const entries = data.rows
      .filter(({ r }) => r >= area.top && r <= area.bottom)
      .flatMap(({ r, cells }) =>
        cells
          .filter(({ c }) => c >= area.left && c <= area.right)
          .map(({ c, v, f }) => `${columnName(c)}${r}：${f !== undefined ? `=${f}` : (v ?? '')}`),
      );
    onPick?.({ anchor: { kind: 'cells', sheet: data.name, range }, quote: entries.join('\n').slice(0, 2400) });
  }
  const oldCells = useMemo(() => cellMap(before), [before]);
  const newCells = useMemo(() => cellMap(data), [data]);
  function renderCell(row: number, col: number, value: string): ReactNode {
    const cell = `${columnName(col)}${row}`;
    const marked =
      selected !== undefined &&
      row >= selected.top &&
      row <= selected.bottom &&
      col >= selected.left &&
      col <= selected.right;
    const key = row + ':' + col;
    const old = oldCells.get(key),
      current = newCells.get(key);
    const change: VersionChange | undefined =
      before === undefined || (current?.v === old?.v && current?.f === old?.f)
        ? undefined
        : old
          ? { kind: 'modified', before: old.f === undefined ? String(old.v ?? '') : '=' + old.f }
          : { kind: 'added' };
    if (!onPick)
      return (
        <>
          <span>{value}</span>
          <ChangeMark change={change} />
        </>
      );
    return (
      <button
        type="button"
        className={styles.cell}
        aria-label={`${cell}${value === '' ? '' : ` ${value}`}`}
        aria-pressed={marked}
        onClick={(event) => pick({ row, col, value }, event)}
      >
        {value || '\u00a0'}
        <ChangeMark change={change} />
      </button>
    );
  }
  return <SheetView data={data} renderCell={onPick === undefined && before === undefined ? undefined : renderCell} />;
}

/** 工作区预览只比较相邻两次实际读到的正文；正式版本仍由节点成功提交后生成。 */
export function DocumentDraftPreview({ draft, follow }: { draft: RepositoryDocumentDraft; follow: boolean }) {
  const [snapshot, setSnapshot] = useState(() => ({ text: draft.text, changes: new Map<number, VersionChange>() }));
  if (snapshot.text !== draft.text) setSnapshot({ text: draft.text, changes: changedLines(snapshot.text, draft.text) });
  const pane = useRef<HTMLElement>(null);
  const attach = useCallback((element: HTMLElement | null) => {
    pane.current = element;
    return sizeReadingPane(element);
  }, []);
  useLayoutEffect(() => {
    if (!follow || !snapshot.changes.size || !pane.current) return;
    const mark = pane.current.querySelector('[data-kind]');
    if (mark) revealInPane(pane.current, mark);
  }, [follow, snapshot]);
  return (
    <section aria-label={ARTIFACT_COPY.workingDraft} className={styles.reader} ref={attach}>
      {draft.truncated && <p className="hint">{ARTIFACT_COPY.truncated}</p>}
      {/\.md$/i.test(draft.path) ? (
        <Content source={snapshot.text} changes={snapshot.changes} />
      ) : (
        <Lines
          source={snapshot.text}
          changes={snapshot.changes}
          focusLine={follow ? snapshot.changes.keys().next().value : undefined}
        />
      )}
    </section>
  );
}

export function ArtifactPreview({
  follow = false,
  taskId,
  version,
  previous,
  onPick,
}: {
  follow?: boolean;
  taskId: string;
  version: ArtifactVersion;
  previous?: ArtifactVersion | undefined;
  onPick?: OnPick | undefined;
}) {
  const [sheet, setSheet] = useState<string>();
  const [plain, setPlain] = useState(false);
  const view = useQuery({
    ...versionQuery(taskId, version.id, sheet),
    placeholderData: (previous) => previous,
  });
  const old = useQuery(versionQuery(taskId, previous?.id));
  const prior = old.data;
  const current = view.data;
  const name = current?.format === 'xlsx' ? current.sheet.name : undefined;
  const needsSheet =
    prior?.format === 'xlsx' && prior.sheet.name !== name && prior.meta.sheets.some((s) => s.name === name);
  const otherSheet = useQuery(versionQuery(taskId, needsSheet ? previous?.id : undefined, name));
  const oldSheet =
    prior?.format !== 'xlsx'
      ? undefined
      : prior.sheet.name === name
        ? prior.sheet
        : needsSheet
          ? otherSheet.data?.format === 'xlsx'
            ? otherSheet.data.sheet
            : undefined
          : null;
  const changes = useMemo(() => {
    if (!current || !prior || current.format !== prior.format || current.format === 'xlsx' || prior.format === 'xlsx')
      return new Map<number, VersionChange>();
    return changedLines(
      prior.format === 'docx' ? prior.markdown : prior.text,
      current.format === 'docx' ? current.markdown : current.text,
    );
  }, [current, prior]);
  const content = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 异步版本、工作表或显示模式会替换待定位的 DOM。
  useLayoutEffect(() => {
    if (!follow || view.isPlaceholderData) return;
    const target = content.current?.querySelector('[data-kind]');
    const pane = content.current?.closest('section');
    if (target && pane) revealInPane(pane, target);
  }, [follow, changes, oldSheet, plain, current, view.isPlaceholderData]);
  if (view.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  const data = view.data;
  if (data.format === AttachmentFormat.Xlsx) {
    return (
      <div className="col" ref={content}>
        <fieldset className={`row wrap ${styles.sheets}`} aria-label={ARTIFACT_COPY.sheets}>
          {data.meta.sheets.map(({ name, hidden }) => (
            <Button
              key={name}
              size="sm"
              aria-pressed={name === (sheet ?? data.sheet.name)}
              variant={name === (sheet ?? data.sheet.name) ? 'secondary' : 'ghost'}
              onClick={() => setSheet(name)}
            >
              {name}
              {hidden && ARTIFACT_COPY.hidden}
            </Button>
          ))}
        </fieldset>
        <Workbook
          before={oldSheet}
          key={data.sheet.name}
          data={data.sheet}
          onPick={view.isPlaceholderData ? undefined : onPick}
        />
      </div>
    );
  }
  if (data.format === AttachmentFormat.Docx)
    return (
      <div ref={content}>
        <Content changes={changes} source={data.markdown} onPick={onPick} />
      </div>
    );
  return (
    <div className="col" ref={content}>
      {data.format === 'md' && (
        <div className="row">
          <Button
            size="sm"
            variant={plain ? 'ghost' : 'secondary'}
            aria-pressed={!plain}
            onClick={() => setPlain(false)}
          >
            {ARTIFACT_COPY.body}
          </Button>
          <Button size="sm" variant={plain ? 'secondary' : 'ghost'} aria-pressed={plain} onClick={() => setPlain(true)}>
            {ARTIFACT_COPY.source}
          </Button>
        </div>
      )}
      {data.truncated && <p className="hint">{ARTIFACT_COPY.truncated}</p>}
      {data.format === 'txt' || plain ? (
        <Lines
          focusLine={follow ? changes.keys().next().value : undefined}
          changes={changes}
          source={data.text}
          onPick={onPick}
        />
      ) : (
        <Content changes={changes} source={data.text} onPick={onPick} />
      )}
    </div>
  );
}
