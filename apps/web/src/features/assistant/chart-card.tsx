import { assertNever, type ChartSpec, ChartType, type ShowChartInput } from '@aw/shared';
import { BarChart } from '../../components/charts/bar-chart.tsx';
import { isHorizontalBar } from '../../components/charts/chart-math.ts';
import chartStyles from '../../components/charts/charts.module.css';
import { DonutChart } from '../../components/charts/donut-chart.tsx';
import { FlowChart } from '../../components/charts/flow-chart.tsx';
import { HBarChart } from '../../components/charts/hbar-chart.tsx';
import { LineChart } from '../../components/charts/line-chart.tsx';
import { toneOf } from '../../components/charts/series.ts';
import { CHART_COPY as C, formatChartAxis, formatChartValue } from '../../copy/charts.ts';
import cards from './cards.module.css';

/** Bar and pie values: the checks keep null out of them (show_chart, 35 §3.1). */
function definite(values: readonly (number | null)[]): number[] {
  return values.map((value) => {
    if (value === null) throw new Error('A bar or pie value is null');
    return value;
  });
}

function StatChart({ chart }: { chart: ShowChartInput }) {
  const format = (value: number) => formatChartValue(value, chart.unit);
  const series = chart.series.map((s, i) => ({ name: s.name, tone: toneOf(i), values: s.values }));
  const common = { label: chart.title, columnHeader: C.category, tableCaption: C.table, format };
  switch (chart.type) {
    case ChartType.Bar: {
      const stacked = chart.stacked ?? false;
      const bars = series.map((s) => ({ ...s, values: definite(s.values) }));
      if (isHorizontalBar(chart.categories)) {
        return <HBarChart {...common} categories={chart.categories} series={bars} stacked={stacked} />;
      }
      return (
        <BarChart
          {...common}
          series={bars}
          days={chart.categories.map((category, i) => ({
            date: category,
            values: bars.map((s) => ({ series: s, value: s.values[i] ?? 0 })),
          }))}
          formatAxis={formatChartAxis}
          formatDate={(category) => category}
          stacked={stacked}
        />
      );
    }
    case ChartType.Line:
      return (
        <LineChart
          {...common}
          categories={chart.categories}
          series={series}
          formatAxis={formatChartAxis}
          missing={C.missing}
        />
      );
    case ChartType.Pie: {
      const [only] = chart.series;
      if (only === undefined) throw new Error('A pie without its series');
      return (
        <DonutChart
          {...common}
          categories={chart.categories}
          values={definite(only.values)}
          seriesName={only.name}
          shareHeader={C.share}
          formatShare={C.percent}
        />
      );
    }
    default:
      return assertNever(chart.type);
  }
}

/** A chart the assistant drew (35 §5): its title, the chart, and what the numbers count. */
export function ChartCard({ chart, fresh }: { chart: ChartSpec; fresh: boolean }) {
  return (
    <div className={`${cards.card} ${cards.chartCard}`} data-testid="assistant-chart">
      {/* The figure inside carries the title as its accessible name. */}
      <div className={cards.chartTitle} aria-hidden="true">
        {chart.title}
      </div>
      <div className={fresh ? chartStyles.grow : undefined}>
        {chart.type === ChartType.Flow ? (
          <FlowChart
            label={chart.title}
            nodes={chart.nodes}
            edges={chart.edges}
            shapeName={(shape) => C.shape[shape]}
            describeEdge={C.edge}
            nodesCaption={C.nodes}
            edgesCaption={C.edges}
          />
        ) : (
          <StatChart chart={chart} />
        )}
      </div>
      {chart.caption !== undefined && chart.caption !== '' && <p className={cards.chartCaption}>{chart.caption}</p>}
    </div>
  );
}
