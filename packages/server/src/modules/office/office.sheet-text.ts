import {
  columnName,
  SHEET_GRID_MAX_COLUMNS,
  SHEET_OVERVIEW_HEAD_ROWS,
  SHEET_OVERVIEW_SHEETS,
  SHEET_OVERVIEW_TAIL_ROWS,
  type XlsxMeta,
} from '@aw/shared';
import { extentOf, type Workbook, type WorkbookCell, type WorkbookRow, type WorkbookSheet } from './office.workbook.ts';

const cellText = (cell: WorkbookCell) =>
  (cell.v === null && cell.f !== undefined ? `=${cell.f}` : String(cell.v ?? ''))
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, '<br>');

/** A sheet's heading, with its range and size, and lines for merged cells and hidden columns. */
function heading(sheet: WorkbookSheet, shown?: string): string[] {
  const { rows, columns } = extentOf(sheet);
  const notes = [sheet.range === null ? '空' : `${sheet.range}，${rows} 行 × ${columns} 列`];
  if (sheet.hidden) notes.push('隐藏的工作表');
  const lines = [`## 工作表「${sheet.name}」（${notes.join('，')}${shown === undefined ? '' : `；${shown}`}）`];
  if (sheet.merges.length > 0) lines.push(`合并单元格：${sheet.merges.join('、')}`);
  if (sheet.hiddenColumns.length > 0) lines.push(`隐藏的列：${sheet.hiddenColumns.map(columnName).join('、')}`);
  return lines;
}

/**
 * A Markdown table whose first column is the row number and whose header is the column letters, so the model can
 * name cells as `C17` (39 §5.3); a sheet wider than `SHEET_GRID_MAX_COLUMNS` lists its cells by address instead. A
 * number in `rows` stands for that many rows left out.
 */
function table(sheet: WorkbookSheet, rows: ReadonlyArray<WorkbookRow | number>): string[] {
  const { left, columns } = extentOf(sheet);
  const label = (row: WorkbookRow) => `${row.r}${row.hidden ? '（隐藏）' : ''}`;
  if (columns > SHEET_GRID_MAX_COLUMNS) {
    // Cell by cell, so the text grows with the cells rather than rows × columns (39 §5.3).
    return [
      '',
      '列太多，逐个列出有内容的单元格：',
      ...rows.map((row) =>
        typeof row === 'number'
          ? `- …（省略 ${row} 行）`
          : `- ${label(row)}：${row.cells.map((cell) => `${columnName(cell.c)}${row.r} = ${cellText(cell)}`).join('；')}`,
      ),
    ];
  }
  const letters = Array.from({ length: columns }, (_, i) => columnName(left + i));
  const lines = ['', `| 行 | ${letters.join(' | ')} |`, `| --- | ${letters.map(() => '---').join(' | ')} |`];
  for (const row of rows) {
    if (typeof row === 'number') {
      lines.push(`| … | 省略 ${row} 行${' |'.repeat(columns)}`);
      continue;
    }
    const cells = Array<string>(columns).fill('');
    for (const cell of row.cells) cells[cell.c - left] = cellText(cell);
    lines.push(`| ${label(row)} | ${cells.join(' | ')} |`);
  }
  return lines;
}

/** Every sheet in full: `text.md`, which `read_attachment` and the preview read. */
export function workbookText(workbook: Workbook): string {
  const sections = workbook.sheets.map((sheet) =>
    [...heading(sheet), ...(sheet.range === null ? [] : table(sheet, sheet.rows))].join('\n'),
  );
  return `${sections.join('\n\n')}\n`;
}

/**
 * What the prompt shows of a workbook (39 §6.1): each sheet's first and last rows, the rest left to `read_sheet` and
 * `query_sheet`. Written as `overview.md` when the attachment is saved, so prompts read it without parsing cells.
 */
export function workbookOverview(workbook: Workbook, meta: XlsxMeta): string {
  const shown = workbook.sheets.slice(0, SHEET_OVERVIEW_SHEETS);
  const sections = shown.map((sheet) => {
    const { rows } = sheet;
    const cut = rows.length > SHEET_OVERVIEW_HEAD_ROWS + SHEET_OVERVIEW_TAIL_ROWS;
    const picked = cut
      ? [
          ...rows.slice(0, SHEET_OVERVIEW_HEAD_ROWS),
          rows.length - SHEET_OVERVIEW_HEAD_ROWS - SHEET_OVERVIEW_TAIL_ROWS,
          ...rows.slice(-SHEET_OVERVIEW_TAIL_ROWS),
        ]
      : rows;
    const note = cut ? `下面是前 ${SHEET_OVERVIEW_HEAD_ROWS} 行与最后 ${SHEET_OVERVIEW_TAIL_ROWS} 行` : undefined;
    return [...heading(sheet, note), ...(sheet.range === null ? [] : table(sheet, picked))].join('\n');
  });
  const rest = workbook.sheets.slice(SHEET_OVERVIEW_SHEETS);
  if (rest.length > 0) sections.push(`其余 ${rest.length} 个工作表：${rest.map((s) => `「${s.name}」`).join('、')}`);
  const notes: string[] = [];
  if (meta.formulas > 0) notes.push(`有 ${meta.formulas} 个公式，显示的是文件里保存的结果`);
  const unread = [
    [meta.charts, '图表'],
    [meta.images, '图片'],
    [meta.pivotTables, '透视表'],
  ].filter(([n]) => (n as number) > 0);
  if (unread.length > 0) notes.push(`${unread.map(([n, what]) => `${n} 个${what}`).join('、')}没有读取`);
  if (notes.length > 0) sections.push(`${notes.join('；')}。`);
  return `${sections.join('\n\n')}\n`;
}
