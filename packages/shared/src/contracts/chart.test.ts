import { describe, expect, it } from 'vitest';
import { transcriptEntrySchema } from './api/attempts.ts';
import { showChartInputSchema, showFlowchartInputSchema } from './chart.ts';

const bar = {
  type: 'bar',
  title: '本周任务',
  categories: ['已完成', '待合并', '失败'],
  series: [{ name: '任务数', values: [7, 2, 1] }],
};

const flow = {
  title: '修 Bug',
  nodes: [
    { id: 'start', label: '开始', shape: 'terminal' },
    { id: 'fix', label: '修复' },
    { id: 'test', label: '测试通过吗？', shape: 'decision' },
    { id: 'end', label: '结束', shape: 'terminal' },
  ],
  edges: [
    { from: 'start', to: 'fix' },
    { from: 'fix', to: 'test' },
    { from: 'test', to: 'end', label: '通过' },
    { from: 'test', to: 'fix', label: '失败' },
  ],
};

/** The paths and messages of the issues, to see what the model is told to fix. */
function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);
}

describe('show_chart 的输入', () => {
  it('接受柱状、折线（含负数与缺值）与饼图', () => {
    expect(showChartInputSchema.safeParse({ ...bar, stacked: true, unit: '个', caption: '本周' }).success).toBe(true);
    const line = { ...bar, type: 'line', series: [{ name: '净增', values: [3, null, -2] }] };
    expect(showChartInputSchema.safeParse(line).success).toBe(true);
    expect(showChartInputSchema.safeParse({ ...bar, type: 'pie' }).success).toBe(true);
  });

  it('系列与类别不等长时指出是哪个系列', () => {
    const result = showChartInputSchema.safeParse({
      ...bar,
      series: [...bar.series, { name: '上周', values: [1, 2] }],
    });
    expect(issues(result)).toEqual([['series.1.values', '2 values for 3 categories']]);
  });

  it('饼图恰好一个系列、总和为正，超过 8 片时提示合并为「其他」', () => {
    const twoSeries = { ...bar, type: 'pie', series: [...bar.series, { name: '上周', values: [1, 1, 1] }] };
    expect(issues(showChartInputSchema.safeParse(twoSeries))).toEqual([['series', 'a pie has exactly one series']]);
    const empty = { ...bar, type: 'pie', series: [{ name: '任务数', values: [0, 0, 0] }] };
    expect(issues(showChartInputSchema.safeParse(empty))).toEqual([
      ['series.0.values', 'a pie needs a positive total'],
    ]);
    const nine = Array.from({ length: 9 }, (_, i) => `类${i}`);
    const many = { ...bar, type: 'pie', categories: nine, series: [{ name: '数', values: nine.map(() => 1) }] };
    expect(issues(showChartInputSchema.safeParse(many))).toEqual([
      ['categories', 'a pie has at most 8 slices; merge the smallest into one named 其他'],
    ]);
  });

  it('柱状图拒绝负数与 null，折线图以外不能堆叠', () => {
    const result = showChartInputSchema.safeParse({ ...bar, series: [{ name: '任务数', values: [-1, null, 1] }] });
    expect(issues(result)).toEqual([
      ['series.0.values.0', 'must be ≥ 0 in a bar chart'],
      ['series.0.values.1', 'null is for missing values in a line chart only'],
    ]);
    expect(issues(showChartInputSchema.safeParse({ ...bar, type: 'line', stacked: false }))).toEqual([
      ['stacked', 'stacked is for bar charts only'],
    ]);
  });

  it('拒绝重复的类别与系列名，折线图至少两个类别', () => {
    const result = showChartInputSchema.safeParse({
      ...bar,
      categories: ['后端', '前端', '后端'],
      series: [bar.series[0], { name: '任务数', values: [1, 1, 1] }],
    });
    expect(issues(result)).toEqual([
      ['categories.2', 'duplicate category "后端"'],
      ['series.1.name', 'duplicate series name'],
    ]);
    const single = { ...bar, type: 'line', categories: ['周一'], series: [{ name: '数', values: [1] }] };
    expect(issues(showChartInputSchema.safeParse(single))).toEqual([
      ['categories', 'a line chart needs 2–90 categories'],
    ]);
  });
});

describe('show_flowchart 的输入', () => {
  it('接受带判断与回环的流程', () => {
    expect(showFlowchartInputSchema.safeParse(flow).success).toBe(true);
  });

  it('拒绝重复的节点、未知节点、自环与重复连线', () => {
    const result = showFlowchartInputSchema.safeParse({
      ...flow,
      nodes: [...flow.nodes, { id: 'fix', label: '再修' }],
      edges: [...flow.edges, { from: 'fix', to: 'deploy' }, { from: 'end', to: 'end' }, { from: 'start', to: 'fix' }],
    });
    expect(issues(result)).toEqual([
      ['nodes.4.id', 'duplicate node id "fix"'],
      ['edges.4.to', 'no node with id "deploy"'],
      ['edges.5', 'an edge cannot join a node to itself'],
      ['edges.6', 'duplicate edge between the same two nodes'],
    ]);
  });
});

describe('会话流的 chart 条目', () => {
  // A line as the first release writes it: entries already on disk must keep parsing (D133).
  const stored = [
    { seq: 4, ts: 1761300000000, kind: 'chart', data: { chart: { ...bar, unit: '个' } } },
    { seq: 5, ts: 1761300000001, kind: 'chart', data: { chart: { type: 'flow', ...flow } } },
  ];

  it('第一版写下的柱状图与流程图条目可以解析', () => {
    for (const line of stored) expect(transcriptEntrySchema.parse(line)).toEqual(line);
  });
});
