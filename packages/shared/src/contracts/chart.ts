import { z } from 'zod';
import {
  CHART_CAPTION_MAX_CHARS,
  CHART_CATEGORIES,
  CHART_LABEL_MAX_CHARS,
  CHART_SERIES_MAX,
  CHART_TITLE_MAX_CHARS,
  CHART_UNIT_MAX_CHARS,
  FLOWCHART_EDGE_LABEL_MAX_CHARS,
  FLOWCHART_EDGES_MAX,
  FLOWCHART_NODE_ID_MAX_CHARS,
  FLOWCHART_NODES_MAX,
} from '../constants/limits.ts';
import { ChartType, flowNodeShapeSchema } from '../enums/assistant.ts';

const label = z.string().min(1).max(CHART_LABEL_MAX_CHARS);
const title = z.string().min(1).max(CHART_TITLE_MAX_CHARS).describe('Shown above the chart');
const caption = z
  .string()
  .max(CHART_CAPTION_MAX_CHARS)
  .optional()
  .describe('What the numbers count and where they come from, e.g. "Tasks finished this week"');

/** Indexes of the values that repeat an earlier one. */
function duplicates(values: readonly string[]): number[] {
  return values.flatMap((value, i) => (values.indexOf(value) < i ? [i] : []));
}

const chartShape = {
  type: z.enum([ChartType.Bar, ChartType.Line, ChartType.Pie]),
  title,
  categories: z
    .array(label)
    .min(1)
    .max(CHART_CATEGORIES.line.max)
    .describe(
      `Category or x-axis labels, shown in this order: bar ${CHART_CATEGORIES.bar.max} at most, line ${CHART_CATEGORIES.line.min}–${CHART_CATEGORIES.line.max}, pie ${CHART_CATEGORIES.pie.max} at most`,
    ),
  series: z
    .array(
      z.strictObject({
        name: label,
        values: z
          .array(z.number().nullable())
          .describe('One per category, in the same order; null only in a line chart, for a missing value'),
      }),
    )
    .min(1)
    .max(CHART_SERIES_MAX)
    .describe('A pie has exactly one series'),
  stacked: z.boolean().optional().describe('Bar only: stack the series instead of putting them side by side'),
  unit: z.string().max(CHART_UNIT_MAX_CHARS).optional().describe('Appended to values, e.g. "%", "tokens", "分钟"'),
  caption,
};

type ChartFields = z.infer<z.ZodObject<typeof chartShape>>;

/** The rules between fields (34 §3.1, D134), worded so the model knows how to fix the call. */
function checkChart(chart: ChartFields, ctx: z.RefinementCtx): void {
  const { type, categories, series } = chart;
  const range = CHART_CATEGORIES[type];
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (categories.length < range.min || categories.length > range.max) {
    issue(
      ['categories'],
      type === ChartType.Pie
        ? `a pie has at most ${range.max} slices; merge the smallest into one named 其他`
        : `a ${type} chart needs ${range.min}–${range.max} categories`,
    );
  }
  for (const i of duplicates(categories)) issue(['categories', i], `duplicate category "${categories[i]}"`);
  for (const i of duplicates(series.map((s) => s.name))) issue(['series', i, 'name'], 'duplicate series name');
  if (type === ChartType.Pie && series.length !== 1) issue(['series'], 'a pie has exactly one series');
  if (chart.stacked !== undefined && type !== ChartType.Bar) issue(['stacked'], 'stacked is for bar charts only');
  series.forEach((s, i) => {
    if (s.values.length !== categories.length) {
      issue(['series', i, 'values'], `${s.values.length} values for ${categories.length} categories`);
    }
    s.values.forEach((value, j) => {
      if (value === null && type !== ChartType.Line) {
        issue(['series', i, 'values', j], 'null is for missing values in a line chart only');
      } else if (value !== null && value < 0 && type !== ChartType.Line) {
        issue(['series', i, 'values', j], `must be ≥ 0 in a ${type} chart`);
      }
    });
  });
  const [only] = series;
  if (type === ChartType.Pie && only !== undefined && only.values.reduce<number>((sum, v) => sum + (v ?? 0), 0) <= 0) {
    issue(['series', 0, 'values'], 'a pie needs a positive total');
  }
}

/** `show_chart` (34 §3.1): a bar, line or pie chart from figures the assistant got from other tools. */
export const showChartInputSchema = z.strictObject(chartShape).superRefine(checkChart);
export type ShowChartInput = z.infer<typeof showChartInputSchema>;

const flowchartShape = {
  title,
  nodes: z
    .array(
      z.strictObject({
        id: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .max(FLOWCHART_NODE_ID_MAX_CHARS)
          .describe('Letters, digits, _ and -; used by edges'),
        label,
        shape: flowNodeShapeSchema
          .optional()
          .describe('step (default), decision (a question with labelled outgoing edges), terminal (start or end)'),
      }),
    )
    .min(1)
    .max(FLOWCHART_NODES_MAX),
  edges: z
    .array(
      z.strictObject({
        from: z.string(),
        to: z.string(),
        label: z.string().max(FLOWCHART_EDGE_LABEL_MAX_CHARS).optional().describe('A condition, e.g. "通过"'),
      }),
    )
    .max(FLOWCHART_EDGES_MAX)
    .describe('Loops back to an earlier node are allowed'),
  caption,
};

type FlowchartFields = z.infer<z.ZodObject<typeof flowchartShape>>;

/** Edges join known nodes; loops back are allowed, an edge to itself is not (34 §3.2). */
function checkFlowchart({ nodes, edges }: FlowchartFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const ids = nodes.map((n) => n.id);
  for (const i of duplicates(ids)) issue(['nodes', i, 'id'], `duplicate node id "${ids[i]}"`);
  const known = new Set(ids);
  edges.forEach((edge, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!known.has(edge[end])) issue(['edges', i, end], `no node with id "${edge[end]}"`);
    }
    if (edge.from === edge.to) issue(['edges', i], 'an edge cannot join a node to itself');
  });
  for (const i of duplicates(edges.map((e) => `${e.from}\u0000${e.to}`))) {
    issue(['edges', i], 'duplicate edge between the same two nodes');
  }
}

/** `show_flowchart` (34 §3.2). */
export const showFlowchartInputSchema = z.strictObject(flowchartShape).superRefine(checkFlowchart);
export type ShowFlowchartInput = z.infer<typeof showFlowchartInputSchema>;

/**
 * A chart as the conversation's `chart` entry keeps it (10 §3, D133): the checked tool input, a flowchart tagged
 * `flow`. Old entries must keep parsing, so changes only add optional fields or chart types.
 */
export const chartSpecSchema = z.discriminatedUnion('type', [
  showChartInputSchema,
  z.strictObject({ type: z.literal(ChartType.Flow), ...flowchartShape }).superRefine(checkFlowchart),
]);
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const shownOutputSchema = z.object({ shown: z.literal(true) });
