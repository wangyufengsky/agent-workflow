import { useState } from 'react';
import { INSIGHTS_COPY as C, formatDay } from '../../copy/insights.ts';
import styles from './charts.module.css';
import { type SeriesTone, toneClass } from './series.ts';
import { niceTicks } from './ticks.ts';

/** A series and its colour. */
export type BarSeries = { name: string; tone: SeriesTone };
/** One day: a value per series, in the order of the chart's series. */
export type BarDay = { date: string; values: readonly { series: BarSeries; value: number }[] };

/** About this many date labels fit under the bars at 1280 wide. */
const MAX_DATE_LABELS = 10;

/**
 * Columns of bars, the series stacked or side by side (D80: no chart library); by day unless `formatDate` says
 * otherwise. The hovered or focused column is read out above the bars; a visually hidden table carries the same
 * numbers for screen readers.
 */
export function BarChart({
  label,
  series,
  days,
  format,
  formatAxis,
  formatDate = formatDay,
  tableCaption = C.trendTable,
  columnHeader = C.date,
  max,
  stacked = true,
}: {
  label: string;
  series: readonly BarSeries[];
  days: readonly BarDay[];
  format: (value: number) => string;
  formatAxis: (value: number) => string;
  /** A column's label; days by default, a bucket's first day otherwise. */
  formatDate?: (date: string) => string;
  tableCaption?: string;
  /** The table's header over the column labels. */
  columnHeader?: string;
  /** The axis' top when the values have a fixed range (a rate's 1), whatever the data reach. */
  max?: number;
  /** false puts the series side by side in each column. */
  stacked?: boolean;
}) {
  const [active, setActive] = useState<BarDay | null>(null);
  const reach = (day: BarDay) =>
    stacked ? day.values.reduce((sum, v) => sum + v.value, 0) : Math.max(0, ...day.values.map((v) => v.value));
  const ticks = niceTicks(max ?? Math.max(0, ...days.map(reach)));
  const top = Math.max(...ticks);
  const height = (value: number) => (top === 0 ? 0 : (value / top) * 100);
  const every = Math.ceil(days.length / MAX_DATE_LABELS);
  const readout = (day: BarDay) =>
    [formatDate(day.date), ...day.values.map((v) => `${v.series.name} ${format(v.value)}`)].join(' · ');

  const segments = (day: BarDay) =>
    day.values.map((v) => (
      <span
        key={v.series.name}
        className={`${styles.segment} ${toneClass(v.series.tone)}`}
        style={{ height: `${height(v.value)}%` }}
      />
    ));

  return (
    <figure className={styles.chart} aria-label={label}>
      <figcaption className={styles.readout} aria-live="polite">
        {active === null ? (
          <span className={styles.legend}>
            {series.map((s) => (
              <span key={s.name}>
                <i className={toneClass(s.tone)} aria-hidden="true" />
                {s.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={styles.value}>{readout(active)}</span>
        )}
      </figcaption>
      <div className={styles.plot}>
        {ticks.map((tick) => (
          <div key={tick} className={styles.tick} style={{ bottom: `${height(tick)}%` }}>
            <span>{formatAxis(tick)}</span>
          </div>
        ))}
        <div className={styles.bars}>
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={styles.column}
              aria-label={readout(day)}
              onMouseEnter={() => setActive(day)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(day)}
              onBlur={() => setActive(null)}
            >
              {stacked ? (
                segments(day)
              ) : (
                // Narrower than its column, so each category's bars read as one group.
                <span className={styles.group}>{segments(day)}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.dates} aria-hidden="true">
        {days.map((day, i) => (
          <span key={day.date}>{i % every === 0 ? formatDate(day.date) : ''}</span>
        ))}
      </div>
      <table className="sr">
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th>{columnHeader}</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{formatDate(day.date)}</td>
              {day.values.map((v) => (
                <td key={v.series.name}>{format(v.value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
