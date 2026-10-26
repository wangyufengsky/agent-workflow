/** A cell as the model reads it: dates are ISO 8601, errors their text (`#DIV/0!`), rich text plain. */
export type WorkbookValue = string | number | boolean | null;
/** `c` is the 1-based column; `f` the formula, whose value is what the file cached (null when it cached none). */
export type WorkbookCell = { c: number; v: WorkbookValue; f?: string };
export type WorkbookRow = { r: number; hidden: boolean; cells: WorkbookCell[] };
export type WorkbookSheet = {
  name: string;
  hidden: boolean;
  /** The cells with content, e.g. `A1:F1204`; null for an empty sheet. */
  range: string | null;
  merges: string[];
  hiddenColumns: number[];
  rows: WorkbookRow[];
};
/** `workbook.json` of an Excel attachment (39 §5): what previews and the sheet tools read. */
export type Workbook = { sheets: WorkbookSheet[] };

/** `A` → `1`, `AA` → `27`. */
export const columnNumber = (letters: string) =>
  [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);

/** `C17` → row 17, column 3. */
export function cellRef(ref: string): { row: number; column: number } {
  const [, letters = '', digits = ''] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
  return { row: Number(digits), column: columnNumber(letters) };
}

/** Where a sheet's content is: first row and column, and how many rows and columns it spans. */
export type Extent = { top: number; left: number; rows: number; columns: number };

export function extentOf(sheet: WorkbookSheet): Extent {
  if (sheet.range === null) return { top: 1, left: 1, rows: 0, columns: 0 };
  const [from, to] = sheet.range.split(':').map(cellRef) as [ReturnType<typeof cellRef>, ReturnType<typeof cellRef>];
  return { top: from.row, left: from.column, rows: to.row - from.row + 1, columns: to.column - from.column + 1 };
}
