import {
  type AttachmentDTO,
  AttachmentFormat,
  columnName,
  imageMimeByFormat,
  SHEET_GRID_MAX_COLUMNS,
  type SheetPreviewDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { attachmentContentQuery, attachmentQuery, attachmentSheetQuery } from './attachments.api.ts';
import styles from './attachments.module.css';

const describe = ({ origin, sizeBytes, meta }: AttachmentDTO) => {
  const source =
    origin === null
      ? C.fromUpload
      : 'kind' in origin
        ? C.fromKnowledge
        : C.fromProject(origin.lines === null ? origin.path : `${origin.path}:${origin.lines.from}-${origin.lines.to}`);
  return [source, ...(meta === null ? [] : [C.summary(meta)]), C.size(sizeBytes)].join(' · ');
};

/** As the AI reads a cell (39 §5.3): a formula without a saved result shows as the formula. */
const cellText = ({ v, f }: SheetPreviewDTO['rows'][number]['cells'][number]) =>
  v === null ? (f === undefined ? '' : `=${f}`) : String(v);

/** What was attached, exactly as the AI reads it (30 §3, 39 §8.1): text, a Word body, or an Excel workbook. */
export function AttachmentPreview({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const meta = useQuery(attachmentQuery(id));
  const workbook = meta.data?.meta?.format === AttachmentFormat.Xlsx ? meta.data.meta : undefined;
  const image = meta.data !== undefined && imageMimeByFormat[meta.data.format] !== undefined;
  // An Excel preview reads its sheets one by one instead of the whole text.
  const content = useQuery({
    ...attachmentContentQuery(id, image),
    enabled: meta.data !== undefined && workbook === undefined,
  });
  const error = meta.error ?? content.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={name}
      {...(meta.data === undefined ? {} : { description: describe(meta.data) })}
      footer={<Button onClick={onClose}>{C.close}</Button>}
    >
      {error !== null && <ErrorState error={error} />}
      {meta.data !== undefined && meta.data.meta !== null && <p className="hint">{C.officeNote}</p>}
      {workbook !== undefined ? (
        <Tabs
          items={workbook.sheets.map((sheet) => ({
            value: sheet.name,
            label: sheet.hidden ? C.hiddenSheet(sheet.name) : sheet.name,
            content: <SheetPreview id={id} sheet={sheet.name} />,
          }))}
        />
      ) : content.data !== undefined ? (
        image ? (
          <img className={styles.image} src={content.data} alt={name} />
        ) : meta.data?.format === AttachmentFormat.Docx ? (
          <WordBody markdown={content.data} />
        ) : (
          <pre className={`mono ${styles.preview} ${styles.plain}`}>{content.data}</pre>
        )
      ) : (
        error === null && <p className="hint">{C.loading}</p>
      )}
    </Dialog>
  );
}

function SheetPreview({ id, sheet }: { id: string; sheet: string }) {
  const query = useQuery(attachmentSheetQuery(id, sheet));
  if (query.error !== null) return <ErrorState error={query.error} />;
  if (query.data === undefined) return <p className="hint">{C.loading}</p>;
  return <SheetView data={query.data} />;
}

/** A Word body as the AI reads it (39 §8). */
export function WordBody({ markdown }: { markdown: string }) {
  return (
    <div className={styles.preview}>
      <Markdown source={markdown} />
    </div>
  );
}

/** One sheet's first rows (39 §8.1): a grid, or cell by cell when it is too wide; says when rows are left out. */
type CellRenderer = (row: number, column: number, value: string) => ReactNode;
type SheetProps = { data: SheetPreviewDTO; renderCell?: CellRenderer | undefined };

export function SheetView({ data, renderCell }: SheetProps) {
  if (data.range === null) return <p className="hint">{C.emptySheet}</p>;
  return (
    <div className="col">
      {data.rows.length < data.totalRows && <p className="hint">{C.previewRows(data.totalRows)}</p>}
      {data.columns > SHEET_GRID_MAX_COLUMNS ? (
        <SheetCells data={data} renderCell={renderCell} />
      ) : (
        <SheetGrid data={data} renderCell={renderCell} />
      )}
    </div>
  );
}

/** Row numbers down the side and column letters across the top, as the AI names cells (39 §5.3). */
function SheetGrid({ data, renderCell }: SheetProps) {
  const letters = Array.from({ length: data.columns }, (_, i) => columnName(data.left + i));
  return (
    <div className={styles.sheet} data-testid="sheet-grid">
      <table>
        <thead>
          <tr>
            <th scope="col">{C.row}</th>
            {letters.map((letter) => (
              <th key={letter} scope="col">
                {letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const values = Array<string>(data.columns).fill('');
            for (const cell of row.cells) values[cell.c - data.left] = cellText(cell);
            return (
              <tr key={row.r} data-hidden={row.hidden || undefined}>
                <th scope="row">{row.hidden ? C.hiddenRow(row.r) : row.r}</th>
                {values.map((value, i) => (
                  <td key={letters[i]} title={value === '' ? undefined : value}>
                    {renderCell === undefined ? value : renderCell(row.r, data.left + i, value)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A sheet too wide for a grid, cell by cell as the AI reads it (39 §5.3). */
function SheetCells({ data, renderCell }: SheetProps) {
  return (
    <div className={`${styles.preview} mono`}>
      <p className="hint">{C.wideSheet}</p>
      {data.rows.map((row) => (
        <div key={row.r}>
          {row.hidden ? C.hiddenRow(row.r) : row.r}：
          {renderCell === undefined
            ? row.cells.map((cell) => `${columnName(cell.c)}${row.r} = ${cellText(cell)}`).join('；')
            : row.cells.map((cell) => (
                <span key={cell.c} className="row">
                  {`${columnName(cell.c)}${row.r}`}
                  {renderCell(row.r, cell.c, cellText(cell))}
                </span>
              ))}
        </div>
      ))}
    </div>
  );
}
