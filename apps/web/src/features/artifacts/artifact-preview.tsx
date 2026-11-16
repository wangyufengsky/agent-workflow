import {
  type ArtifactAnchor,
  type ArtifactVersion,
  AttachmentFormat,
  columnName,
  getTaskArtifactOp,
  type SheetPreviewDTO,
  textLines,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type MouseEvent, type ReactNode, useState } from 'react';
import type { Components } from 'react-markdown';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ARTIFACT_COPY } from '../../copy/artifacts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { SheetView } from '../attachments/attachment-preview.tsx';
import styles from './artifact-workbench.module.css';

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

function Content({ source, onPick }: { source: string; onPick?: OnPick | undefined }) {
  const lines = textLines(source);
  function marker(from: number | undefined, to: number | undefined) {
    if (onPick === undefined || from === undefined || to === undefined) return null;
    return (
      <IconButton
        icon="edit"
        label={ARTIFACT_COPY.markLines(from, to)}
        onClick={() => onPick(blockAnchor(lines, from, to))}
        className={styles.mark}
      />
    );
  }
  const components: Components = {
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    p: ({ children, node }) => (
      <p>
        {children}
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </p>
    ),
    li: ({ children, node }) => (
      <li>
        {children}
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </li>
    ),
    table: ({ children, node }) => (
      <div>
        <table>{children}</table>
        {marker(node?.position?.start.line, node?.position?.end.line)}
      </div>
    ),
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

function Lines({ source, onPick }: { source: string; onPick?: OnPick | undefined }) {
  const [start, setStart] = useState(0);
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
            </li>
          );
        })}
      </ol>
      {lines.length > PAGE_LINES && (
        <div className="row wrap">
          <Button size="sm" disabled={start === 0} onClick={() => setStart(start - PAGE_LINES)}>
            {ARTIFACT_COPY.previousPage}
          </Button>
          <span className="hint">{ARTIFACT_COPY.pageLines(start + 1, last, lines.length)}</span>
          <Button size="sm" disabled={last === lines.length} onClick={() => setStart(start + PAGE_LINES)}>
            {ARTIFACT_COPY.nextPage}
          </Button>
        </div>
      )}
    </div>
  );
}

type Cell = { row: number; col: number; value: string };

function Workbook({ data, onPick }: { data: SheetPreviewDTO; onPick?: OnPick | undefined }) {
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
  function renderCell(row: number, col: number, value: string): ReactNode {
    const cell = `${columnName(col)}${row}`;
    const marked =
      selected !== undefined &&
      row >= selected.top &&
      row <= selected.bottom &&
      col >= selected.left &&
      col <= selected.right;
    return (
      <button
        type="button"
        className={styles.cell}
        aria-label={`${cell}${value === '' ? '' : ` ${value}`}`}
        aria-pressed={marked}
        onClick={(event) => pick({ row, col, value }, event)}
      >
        {value || '\u00a0'}
      </button>
    );
  }
  return <SheetView data={data} renderCell={onPick === undefined ? undefined : renderCell} />;
}

export function ArtifactPreview({
  taskId,
  version,
  onPick,
}: {
  taskId: string;
  version: ArtifactVersion;
  onPick?: OnPick | undefined;
}) {
  const [sheet, setSheet] = useState<string>();
  const [plain, setPlain] = useState(false);
  const view = useQuery({
    queryKey: ['task-artifact-version', taskId, version.id, sheet],
    queryFn: () => callOperation(getTaskArtifactOp, { id: taskId, versionId: version.id, sheet }),
    staleTime: Infinity,
    placeholderData: (previous) => previous,
  });
  if (view.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  const data = view.data;
  if (data.format === AttachmentFormat.Xlsx) {
    return (
      <div className="col">
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
        <Workbook key={data.sheet.name} data={data.sheet} onPick={view.isPlaceholderData ? undefined : onPick} />
      </div>
    );
  }
  if (data.format === AttachmentFormat.Docx) return <Content source={data.markdown} onPick={onPick} />;
  return (
    <div className="col">
      {data.format === 'md' && (
        <div className="row">
          <Button size="sm" aria-pressed={!plain} onClick={() => setPlain(false)}>
            {ARTIFACT_COPY.body}
          </Button>
          <Button size="sm" aria-pressed={plain} onClick={() => setPlain(true)}>
            {ARTIFACT_COPY.source}
          </Button>
        </div>
      )}
      {data.truncated && <p className="hint">{ARTIFACT_COPY.truncated}</p>}
      {data.format === 'txt' || plain ? (
        <Lines source={data.text} onPick={onPick} />
      ) : (
        <Content source={data.text} onPick={onPick} />
      )}
    </div>
  );
}
