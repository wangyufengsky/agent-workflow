import { useState } from 'react';
import { INSIGHTS_COPY as C, formatDay } from '../../copy/insights.ts';
import styles from './insights.module.css';

/** Series colours: theme tokens by position (insights.module.css `.s0`…`.s7`), and a neutral one for the rest. */
export const SERIES_TONES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;
export type SeriesTone = (typeof SERIES_TONES)[number] | 'sRest';
/** A series and its colour. */
export type BarSeries = { name: string; tone: SeriesTone };
/** One day: a value per series, in the order of the chart's series. */
export type BarDay = { date: string; values: readonly { series: BarSeries; value: number }[] };

/** About this many date labels fit under the bars at 1280 wide. */
const MAX_DATE_LABELS = 10;

/** Round ticks (steps of 1, 2 or 5 × 10ⁿ, about four of them) from 0 to the first one at or above `max`. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    rough <= magnitude
      ? magnitude
      : rough <= 2 * magnitude
        ? 2 * magnitude
        : rough <= 5 * magnitude
          ? 5 * magnitude
          : 10 * magnitude;
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/**
 * Per-day bars with the series stacked (D80: no chart library). The hovered or focused day is read out above the
 * bars; a visually hidden table carries the same numbers for screen readers.
 */
export function BarChart({
  label,
  series,
  days,
  format,
  formatAxis,
  formatDate = formatDay,
  tableCaption = C.trendTable,
  max,
}: {
  label: string;
  series: readonly BarSeries[];
  days: readonly BarDay[];
  format: (value: number) => string;
  formatAxis: (value: number) => string;
  /** A column's label; days by default, a bucket's first day otherwise. */
  formatDate?: (date: string) => string;
  tableCaption?: string;
  /** The axis' top when the values have a fixed range (a rate's 1), whatever the data reach. */
  max?: number;
}) {
  const [active, setActive] = useState<BarDay | null>(null);
  const ticks = niceTicks(max ?? Math.max(0, ...days.map((d) => d.values.reduce((sum, v) => sum + v.value, 0))));
  const top = Math.max(...ticks);
  const height = (value: number) => (top === 0 ? 0 : (value / top) * 100);
  const every = Math.ceil(days.length / MAX_DATE_LABELS);
  const readout = (day: BarDay) =>
    [formatDate(day.date), ...day.values.map((v) => `${v.series.name} ${format(v.value)}`)].join(' · ');

  return (
    <figure className={styles.chart} aria-label={label}>
      <figcaption className={styles.readout} aria-live="polite">
        {active === null ? (
          <span className={styles.legend}>
            {series.map((s) => (
              <span key={s.name}>
                <i className={styles[s.tone]} aria-hidden="true" />
                {s.name}
              </span>
            ))}
          </span>
        ) : (
          readout(active)
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
              {day.values.map((v) => (
                <span
                  key={v.series.name}
                  className={`${styles.segment} ${styles[v.series.tone]}`}
                  style={{ height: `${height(v.value)}%` }}
                />
              ))}
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
            <th>{C.date}</th>
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
