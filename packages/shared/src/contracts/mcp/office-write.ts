import { z } from 'zod';
import { OFFICE_WRITE_BLOCKS_MAX, OFFICE_WRITE_CELLS_MAX } from '../../constants/limits.ts';
import { querySheetInputSchema } from './sheets.ts';

/**
 * Functions that reach outside the workbook when Excel opens it (39 §7.2): text in an attachment could lead the model
 * to write one that sends the sheet's data away. With external references (`[1]Sheet!A1`, `'C:\[x.xlsx]'!A1`) and DDE
 * (`cmd|' /C …'!A0`), they are refused.
 */
const UNSAFE_FUNCTIONS =
  /\b(WEBSERVICE|FILTERXML|HYPERLINK|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTFEED|IMPORTRANGE|IMAGE|RTD|CALL|REGISTER\.ID|EXEC)\s*\(/i;
export const isSafeFormula = (formula: string) => !UNSAFE_FUNCTIONS.test(formula) && !/[[|]/.test(formula);

/** A file of this conversation's files directory, relative to it (15 §2). */
const fileOf = (extension: string) =>
  z
    .string()
    .min(1)
    .max(200)
    .refine((path) => path.toLowerCase().endsWith(extension), `must end with ${extension}`)
    .describe(`Where to write it, relative to this conversation's files directory, ending with ${extension}`);

/** Text of a Word block: `**bold**`, `*italic*` and `[text](https://…)` are kept, anything else is plain text. */
const text = z.string().max(20_000);

export const docxBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(4), text }),
  z.object({ type: z.literal('paragraph'), text }),
  z.object({ type: z.literal('list'), ordered: z.boolean().default(false), items: z.array(text).min(1) }),
  z.object({
    type: z.literal('table'),
    header: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  }),
  z.object({ type: z.literal('page_break') }),
]);
export type DocxBlock = z.infer<typeof docxBlockSchema>;

/** `create_docx` (39 §7.2): a new Word document from blocks; the app lays it out. */
export const createDocxInputSchema = z.object({
  file: fileOf('.docx'),
  title: z.string().max(200).optional().describe('The document title in its properties; headings go in blocks'),
  blocks: z.array(docxBlockSchema).min(1).max(OFFICE_WRITE_BLOCKS_MAX),
});
export type CreateDocxInput = z.infer<typeof createDocxInputSchema>;

/** A cell to write: a value, a date, or a formula Excel computes when the file is opened. */
export const xlsxCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('YYYY-MM-DD'),
  }),
  z.object({
    formula: z
      .string()
      .min(1)
      .refine(isSafeFormula, 'external references, DDE and functions that reach the network are not allowed')
      .describe('Without the leading =, e.g. SUM(B2:B10)'),
  }),
]);
export type XlsxCell = z.infer<typeof xlsxCellSchema>;

export const XlsxColumnType = {
  Text: 'text',
  Number: 'number',
  Date: 'date',
  Percent: 'percent',
  Currency: 'currency',
} as const;
export type XlsxColumnType = (typeof XlsxColumnType)[keyof typeof XlsxColumnType];

const sheetName = z
  .string()
  .min(1)
  .max(31)
  .refine((name) => !/[[\]:*?/\\]/.test(name), 'a sheet name cannot hold [ ] : * ? / \\');

export const xlsxSheetSchema = z
  .object({
    name: sheetName,
    columns: z
      .array(
        z.object({
          header: z.string().min(1),
          type: z.enum(XlsxColumnType).default(XlsxColumnType.Text).describe('How the column is formatted'),
          width: z.number().min(4).max(100).optional().describe('In characters; omitted: fitted to the content'),
        }),
      )
      .optional()
      .describe('Omitted with rows_from: the query result names them'),
    rows: z.array(z.array(xlsxCellSchema)).optional(),
    rows_from: querySheetInputSchema
      .omit({ limit: true })
      .optional()
      .describe(
        'Fill the sheet with a query_sheet over an attached workbook, without passing the rows through you: all matching rows are written',
      ),
    freeze_header: z.boolean().default(true),
  })
  .superRefine((sheet, ctx) => {
    if ((sheet.rows === undefined) === (sheet.rows_from === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'give either rows or rows_from' });
    }
    if (sheet.rows !== undefined && sheet.columns === undefined) {
      ctx.addIssue({ code: 'custom', path: ['columns'], message: 'rows need columns' });
    }
    const width = sheet.columns?.length;
    sheet.rows?.forEach((row, i) => {
      if (width !== undefined && row.length > width) {
        ctx.addIssue({ code: 'custom', path: ['rows', i], message: `has ${row.length} cells for ${width} columns` });
      }
    });
  });
export type XlsxSheet = z.infer<typeof xlsxSheetSchema>;

/** `create_xlsx` (39 §7.2): a new Excel workbook, one or more sheets with a header row. */
export const createXlsxInputSchema = z
  .object({ file: fileOf('.xlsx'), sheets: z.array(xlsxSheetSchema).min(1).max(50) })
  .superRefine(({ sheets }, ctx) => {
    const names = sheets.map((s) => s.name.toLowerCase());
    names.forEach((name, i) => {
      if (names.indexOf(name) !== i) ctx.addIssue({ code: 'custom', path: ['sheets', i, 'name'], message: 'repeated' });
    });
    const cells = sheets.reduce((n, s) => n + (s.rows ?? []).reduce((m, row) => m + row.length, 0), 0);
    if (cells > OFFICE_WRITE_CELLS_MAX) {
      ctx.addIssue({ code: 'custom', path: ['sheets'], message: `over ${OFFICE_WRITE_CELLS_MAX} cells` });
    }
  });
export type CreateXlsxInput = z.infer<typeof createXlsxInputSchema>;

/** What the create tools return: the file as written (a taken name gets a number, 39 §7.2). */
export const officeFileWrittenSchema = z.object({ file: z.string(), size: z.number() });
export type OfficeFileWritten = z.infer<typeof officeFileWrittenSchema>;
