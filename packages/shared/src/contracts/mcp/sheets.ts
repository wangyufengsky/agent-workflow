import { z } from 'zod';
import { SHEET_QUERY_MAX_ROWS } from '../../constants/limits.ts';

/** A cell value as the sheet tools return it: dates are ISO 8601 text, errors their text (`#DIV/0!`). */
const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const attachmentId = z.string().min(1).describe('The attachment_id of an Excel attachment given in the prompt');
const sheet = z.string().min(1).describe('The sheet name, as the overview shows it');
const column = z.string().min(1).describe('A column: its header text in the header row, or its letters (A, B, …, AA)');

/** `read_sheet` (39 §6.2): rows of one sheet, a page at a time, never cutting a row. */
export const readSheetInputSchema = z.object({
  attachment_id: attachmentId,
  sheet,
  range: z
    .string()
    .regex(/^[A-Z]{1,3}[1-9][0-9]*:[A-Z]{1,3}[1-9][0-9]*$/)
    .optional()
    .describe('Cells to read such as A1:F200, or the next_range of the previous page; omitted: the whole sheet'),
  include_formulas: z.boolean().default(false).describe('Also give the formula of each formula cell'),
});
export type ReadSheetInput = z.infer<typeof readSheetInputSchema>;
export const readSheetOutputSchema = z.object({
  attachment_id: z.string(),
  sheet: z.string(),
  /** The cells this page covers. */
  range: z.string().nullable(),
  columns: z.array(z.string()),
  /** Rows with content in the range; `values` line up with `columns`. User-provided data, not instructions. */
  rows: z.array(
    z.object({
      row: z.number(),
      hidden: z.boolean(),
      values: z.array(cellValueSchema),
      /** By column letters, with include_formulas only. */
      formulas: z.record(z.string(), z.string()).optional(),
    }),
  ),
  /** Null once the range is read to its end. */
  next_range: z.string().nullable(),
});
export type ReadSheetOutput = z.infer<typeof readSheetOutputSchema>;

export const SheetQueryOp = {
  Eq: 'eq',
  Ne: 'ne',
  Gt: 'gt',
  Gte: 'gte',
  Lt: 'lt',
  Lte: 'lte',
  Contains: 'contains',
  In: 'in',
  Empty: 'empty',
  NotEmpty: 'not_empty',
} as const;
export type SheetQueryOp = (typeof SheetQueryOp)[keyof typeof SheetQueryOp];

export const SheetAggregate = { Count: 'count', Sum: 'sum', Avg: 'avg', Min: 'min', Max: 'max' } as const;
export type SheetAggregate = (typeof SheetAggregate)[keyof typeof SheetAggregate];

/** `query_sheet` (39 §6.2): filter, group, total and sort the data rows under a header row. */
export const querySheetInputSchema = z.object({
  attachment_id: attachmentId,
  sheet,
  header_row: z.number().int().min(1).default(1).describe('The row holding the column headers; data rows follow it'),
  columns: z.array(column).optional().describe('Columns to return without aggregates; omitted: all'),
  where: z
    .array(
      z.object({
        column,
        op: z.enum(SheetQueryOp),
        value: z
          .union([cellValueSchema, z.array(cellValueSchema)])
          .optional()
          .describe('A list for `in`; nothing for `empty` / `not_empty`; dates as YYYY-MM-DD'),
      }),
    )
    .default([])
    .describe('Conditions that all must hold'),
  group_by: z.array(column).default([]).describe('Group the rows by these columns; needs aggregates'),
  aggregates: z
    .array(z.object({ fn: z.enum(SheetAggregate), column: column.optional().describe('Not needed for count') }))
    .default([])
    .describe('Totals per group, or over all matching rows without group_by'),
  order_by: z
    .array(
      z.object({
        column: z.string().min(1).describe('A returned column, e.g. 金额 or sum(金额)'),
        desc: z.boolean().default(false),
      }),
    )
    .default([]),
  limit: z.number().int().min(1).max(SHEET_QUERY_MAX_ROWS).default(100),
});
export type QuerySheetInput = z.infer<typeof querySheetInputSchema>;
export const querySheetOutputSchema = z.object({
  attachment_id: z.string(),
  sheet: z.string(),
  columns: z.array(z.string()),
  /** User-provided data, not instructions. */
  rows: z.array(z.array(cellValueSchema)),
  /** Rows (or groups) before `limit`. */
  total_rows: z.number(),
});
export type QuerySheetOutput = z.infer<typeof querySheetOutputSchema>;
