import { FlowNodeShape } from '@aw/shared';

const NUMBER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const AXIS = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

/** A value with its unit; a unit that starts with a letter (tokens, ms) gets a space. */
export const formatChartValue = (n: number, unit = '') =>
  `${NUMBER.format(n)}${/^[A-Za-z]/.test(unit) ? ' ' : ''}${unit}`;
/** Axis ticks: large numbers abbreviated (1.2万). */
export const formatChartAxis = (n: number) => AXIS.format(n);

/** The charts the assistant draws (35 §5). */
export const CHART_COPY = {
  category: '类别',
  table: '图表数据',
  share: '占比',
  missing: '无数据',
  nodes: '流程步骤',
  edges: '连线',
  shape: {
    [FlowNodeShape.Step]: '步骤',
    [FlowNodeShape.Decision]: '判断',
    [FlowNodeShape.Terminal]: '起止',
  } satisfies Record<FlowNodeShape, string>,
  edge: (from: string, to: string, label: string | undefined) =>
    `${from} → ${to}${label === undefined || label === '' ? '' : `（${label}）`}`,
  percent: (n: number) => `${n}%`,
} as const;
