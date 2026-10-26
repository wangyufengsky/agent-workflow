import {
  AppError,
  ATTACHMENT_READ_MAX_CHARS,
  columnName,
  ErrorCode,
  type QuerySheetInput,
  type ReadSheetOutput,
  SheetAggregate,
  type SheetPreviewDTO,
  SheetQueryOp,
} from '@aw/shared';
import {
  cellRef,
  columnNumber,
  extentOf,
  type Workbook,
  type WorkbookSheet,
  type WorkbookValue,
} from './office.workbook.ts';

/** The sheet tools' input without the attachment, which the caller resolved to this workbook. */
export type SheetPageRequest = { sheet: string; range?: string | undefined; include_formulas: boolean };
export type SheetQuery = Omit<QuerySheetInput, 'attachment_id'>;
export type SheetPage = Omit<ReadSheetOutput, 'attachment_id'>;
export type SheetQueryResult = { sheet: string; columns: string[]; rows: WorkbookValue[][]; total_rows: number };

const invalid = (path: string, message: string) =>
  new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: [path], message }] });

function sheetOf(workbook: Workbook, name: string): WorkbookSheet {
  const sheet = workbook.sheets.find((s) => s.name === name);
  if (sheet === undefined) {
    const names = workbook.sheets.map((s) => `"${s.name}"`).join(', ');
    throw invalid('sheet', `No sheet named "${name}"; the sheets are ${names}`);
  }
  return sheet;
}

/**
 * One page of `read_sheet` (39 §6.2): the rows with content inside `range`, up to about `ATTACHMENT_READ_MAX_CHARS` of
 * JSON and at least one row, never cutting a row; `next_range` continues it.
 */
export function readSheetPage(workbook: Workbook, request: SheetPageRequest): SheetPage {
  const sheet = sheetOf(workbook, request.sheet);
  if (sheet.range === null) return { sheet: sheet.name, range: null, columns: [], rows: [], next_range: null };
  const [from, to] = (request.range ?? sheet.range).split(':').map(cellRef) as [
    ReturnType<typeof cellRef>,
    ReturnType<typeof cellRef>,
  ];
  if (from.row > to.row || from.column > to.column)
    throw invalid('range', 'The range must go from top left to bottom right');
  const columns = Array.from({ length: to.column - from.column + 1 }, (_, i) => columnName(from.column + i));
  const rows: SheetPage['rows'] = [];
  // The page as JSON: brackets, rows and the commas between them.
  let chars = 1;
  let last = from.row - 1;
  let full = false;
  for (const row of sheet.rows) {
    if (row.r < from.row || row.r > to.row) continue;
    const inside = row.cells.filter((cell) => cell.c >= from.column && cell.c <= to.column);
    if (inside.length === 0) continue;
    const values = Array<WorkbookValue>(columns.length).fill(null);
    const formulas: Record<string, string> = {};
    for (const cell of inside) {
      values[cell.c - from.column] = cell.v;
      if (request.include_formulas && cell.f !== undefined) formulas[columnName(cell.c)] = cell.f;
    }
    const item = { row: row.r, hidden: row.hidden, values, ...(request.include_formulas ? { formulas } : {}) };
    chars += JSON.stringify(item).length + 1;
    if (rows.length > 0 && chars > ATTACHMENT_READ_MAX_CHARS) {
      full = true;
      break;
    }
    rows.push(item);
    last = row.r;
  }
  const left = columns[0] as string;
  const right = columns[columns.length - 1] as string;
  return {
    sheet: sheet.name,
    range: `${left}${from.row}:${right}${Math.max(last, from.row)}`,
    columns,
    rows,
    next_range: full ? `${left}${last + 1}:${right}${to.row}` : null,
  };
}

const isEmpty = (value: WorkbookValue) => value === null || value === '';

function compare(a: WorkbookValue, b: WorkbookValue): number {
  if (a === b) return 0;
  // Empty cells sort last either way round.
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

/** Strings that hold a number compare as numbers: a header-less sheet often stores 「100」 as text. */
const asNumber = (value: WorkbookValue) =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;

function matches(value: WorkbookValue, op: SheetQueryOp, wanted: SheetQuery['where'][number]['value']): boolean {
  switch (op) {
    case SheetQueryOp.Empty:
      return isEmpty(value);
    case SheetQueryOp.NotEmpty:
      return !isEmpty(value);
    case SheetQueryOp.In:
      return Array.isArray(wanted) && wanted.some((w) => compare(value, w) === 0 || String(value) === String(w));
    case SheetQueryOp.Contains:
      return !isEmpty(value) && String(value).includes(String(wanted ?? ''));
    default: {
      if (wanted === undefined || Array.isArray(wanted) || isEmpty(value)) return false;
      const [x, y] = [asNumber(value), asNumber(wanted)];
      const order = Number.isNaN(x) || Number.isNaN(y) ? compare(value, wanted) : x - y;
      if (op === SheetQueryOp.Eq) return order === 0 || String(value) === String(wanted);
      if (op === SheetQueryOp.Ne) return !(order === 0 || String(value) === String(wanted));
      if (op === SheetQueryOp.Gt) return order > 0;
      if (op === SheetQueryOp.Gte) return order >= 0;
      if (op === SheetQueryOp.Lt) return order < 0;
      return order <= 0;
    }
  }
}

function aggregate(fn: SheetAggregate, values: readonly WorkbookValue[]): WorkbookValue {
  const present = values.filter((v) => !isEmpty(v));
  if (fn === SheetAggregate.Count) return present.length;
  if (fn === SheetAggregate.Min || fn === SheetAggregate.Max) {
    const sorted = [...present].sort(compare);
    return (fn === SheetAggregate.Min ? sorted[0] : sorted[sorted.length - 1]) ?? null;
  }
  const numbers = present.map(asNumber).filter((n) => !Number.isNaN(n));
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, n) => total + n, 0);
  // Rounded past floating point noise, as a spreadsheet would show it.
  return Number((fn === SheetAggregate.Sum ? sum : sum / numbers.length).toPrecision(15));
}

/**
 * `query_sheet` (39 §6.2): the data rows under `header_row`, filtered by `where`; either the chosen columns of each
 * row, or `aggregates` per `group_by` group. Columns are named by header text or by letters.
 */
export function querySheet(workbook: Workbook, query: SheetQuery): SheetQueryResult {
  const sheet = sheetOf(workbook, query.sheet);
  const { left, columns: width } = extentOf(sheet);
  const header = sheet.rows.find((row) => row.r === query.header_row);
  const headerOf = new Map<number, string>();
  for (let c = left; c < left + width; c++) {
    const text = header?.cells.find((cell) => cell.c === c)?.v;
    headerOf.set(c, isEmpty(text ?? null) ? columnName(c) : String(text).trim());
  }
  const resolve = (name: string, path: string): number => {
    for (const [c, text] of headerOf) if (text === name.trim()) return c;
    if (/^[A-Z]{1,3}$/.test(name)) return columnNumber(name);
    throw invalid(
      path,
      `No column "${name}"; the columns are ${[...headerOf.values()].map((t) => `"${t}"`).join(', ')}`,
    );
  };
  const conditions = query.where.map((w, i) => ({ ...w, c: resolve(w.column, `where.${i}.column`) }));
  const data = sheet.rows
    .filter((row) => row.r > query.header_row)
    .map((row) => {
      const values = new Map(row.cells.map((cell) => [cell.c, cell.v]));
      return (c: number) => values.get(c) ?? null;
    })
    .filter((cellAt) => conditions.every(({ c, op, value }) => matches(cellAt(c), op, value)));

  let columns: string[];
  let rows: WorkbookValue[][];
  if (query.aggregates.length === 0) {
    if (query.group_by.length > 0) throw invalid('group_by', 'group_by needs at least one aggregate');
    // All columns by position: two headers may read the same.
    const picked = query.columns?.map((name, i) => resolve(name, `columns.${i}`)) ?? [...headerOf.keys()];
    columns = picked.map((c) => headerOf.get(c) ?? columnName(c));
    rows = data.map((cellAt) => picked.map(cellAt));
  } else {
    const groupBy = query.group_by.map((name, i) => resolve(name, `group_by.${i}`));
    const totals = query.aggregates.map((a, i) => {
      if (a.fn !== SheetAggregate.Count && a.column === undefined) {
        throw invalid(`aggregates.${i}.column`, `${a.fn} needs a column`);
      }
      return { fn: a.fn, c: a.column === undefined ? undefined : resolve(a.column, `aggregates.${i}.column`) };
    });
    const groups = new Map<string, typeof data>();
    for (const cellAt of data) {
      const key = JSON.stringify(groupBy.map(cellAt));
      const members = groups.get(key);
      if (members === undefined) groups.set(key, [cellAt]);
      else members.push(cellAt);
    }
    if (groupBy.length === 0 && groups.size === 0) groups.set('[]', []);
    columns = [
      ...groupBy.map((c) => headerOf.get(c) ?? columnName(c)),
      ...totals.map(({ fn, c }) => (c === undefined ? fn : `${fn}(${headerOf.get(c) ?? columnName(c)})`)),
    ];
    rows = [...groups].map(([key, members]) => [
      ...(JSON.parse(key) as WorkbookValue[]),
      // A count without a column counts rows; any other aggregate skips empty cells.
      ...totals.map(({ fn, c }) =>
        c === undefined
          ? members.length
          : aggregate(
              fn,
              members.map((v) => v(c)),
            ),
      ),
    ]);
  }

  const order = query.order_by.map((o, i) => {
    const at = columns.indexOf(o.column.trim());
    if (at < 0) {
      throw invalid(`order_by.${i}.column`, `"${o.column}" is not a returned column; they are ${columns.join(', ')}`);
    }
    return { at, desc: o.desc };
  });
  if (order.length > 0) {
    rows.sort((a, b) => {
      for (const { at, desc } of order) {
        const d = compare(a[at] ?? null, b[at] ?? null);
        if (d !== 0) return desc && !isEmpty(a[at] ?? null) && !isEmpty(b[at] ?? null) ? -d : d;
      }
      return 0;
    });
  }
  return { sheet: sheet.name, columns, rows: rows.slice(0, query.limit), total_rows: rows.length };
}

/** A sheet's first `maxRows` rows with content, for the attachment preview (39 §8.1). */
export function sheetPreview(workbook: Workbook, name: string, maxRows: number): SheetPreviewDTO {
  const sheet = sheetOf(workbook, name);
  const { left, columns } = extentOf(sheet);
  return {
    name: sheet.name,
    range: sheet.range,
    hidden: sheet.hidden,
    left,
    columns,
    merges: sheet.merges,
    rows: sheet.rows.slice(0, maxRows).map(({ r, hidden, cells }) => ({
      r,
      hidden,
      cells: cells.map(({ c, v, f }) => (v === null && f !== undefined ? { c, v, f } : { c, v })),
    })),
    totalRows: sheet.rows.length,
  };
}
