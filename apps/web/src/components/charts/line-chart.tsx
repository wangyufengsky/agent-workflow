import { useState } from 'react';
import { markedPoints, runs } from './chart-math.ts';
import styles from './charts.module.css';
import { type ChartSeries, toneClass } from './series.ts';
import { niceRange } from './ticks.ts';

/** About this many x labels fit under a chart in the assistant panel. */
const MAX_X_LABELS = 8;
/** Every point is marked while there are at most this many; beyond that only isolated ones are. */
const MAX_MARKED_POINTS = 31;

/**
 * Lines over categories (35 §5.2): null leaves a gap, negative values get a zero line, the second and third series
 * are dashed and dotted so colour is not the only difference. The hovered or focused position is read out above;
 * a visually hidden table carries the numbers.
 */
export function LineChart({
  label,
  categories,
  series,
  format,
  formatAxis,
  columnHeader,
  tableCaption,
  missing,
}: {
  label: string;
  categories: readonly string[];
  series: readonly ChartSeries[];
  format: (value: number) => string;
  formatAxis: (value: number) => string;
  columnHeader: string;
  tableCaption: string;
  /** How a gap reads out. */
  missing: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const known = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceRange(Math.min(...known), Math.max(...known));
  const low = Math.min(...ticks);
  const span = Math.max(...ticks) - low;
  const y = (value: number) => (span === 0 ? 0 : ((value - low) / span) * 100);
  // Each position sits in the middle of its slot, like a bar chart's column.
  const x = (i: number) => ((i + 0.5) / categories.length) * 100;
  const every = Math.ceil(categories.length / MAX_X_LABELS);
  const shown = (value: number | null | undefined) => (value === null || value === undefined ? missing : format(value));
  const readout = (i: number) => [categories[i], ...series.map((s) => `${s.name} ${shown(s.values[i])}`)].join(' · ');

  return (
    <figure className={styles.chart} aria-label={label}>
      <figcaption className={styles.readout} aria-live="polite">
        {active !== null ? (
          readout(active)
        ) : series.length > 1 ? (
          <span className={styles.legend}>
            {series.map((s) => (
              <span key={s.name}>
                <i className={toneClass(s.tone)} aria-hidden="true" />
                {s.name}
              </span>
            ))}
          </span>
        ) : null}
      </figcaption>
      <div className={styles.plot}>
        {ticks.map((tick) => (
          <div
            key={tick}
            className={tick === 0 && low < 0 ? `${styles.tick} ${styles.zero}` : styles.tick}
            style={{ bottom: `${y(tick)}%` }}
          >
            <span>{formatAxis(tick)}</span>
          </div>
        ))}
        <svg className={styles.lines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {series.map((s, index) =>
            runs(s.values).map((run) => (
              <polyline
                key={`${s.name}-${run[0]?.i}`}
                className={toneClass(s.tone)}
                data-dash={index > 0 && index < 3 ? index : undefined}
                points={run.map((p) => `${x(p.i)},${100 - y(p.value)}`).join(' ')}
              />
            )),
          )}
        </svg>
        {series.flatMap((s) =>
          markedPoints(s.values, categories.length <= MAX_MARKED_POINTS).map(({ i, value }) => (
            <span
              key={`${s.name}-${categories[i]}`}
              className={`${styles.point} ${toneClass(s.tone)}`}
              style={{ left: `${x(i)}%`, top: `${100 - y(value)}%` }}
            />
          )),
        )}
        {active !== null && <span className={styles.cursor} style={{ left: `${x(active)}%` }} />}
        <div className={styles.slots}>
          {categories.map((category, i) => (
            <button
              key={category}
              type="button"
              className={styles.slot}
              aria-label={readout(i)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </div>
      </div>
      <div className={styles.dates} aria-hidden="true">
        {categories.map((category, i) => (
          <span key={category}>{i % every === 0 ? category : ''}</span>
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
          {categories.map((category, i) => (
            <tr key={category}>
              <td>{category}</td>
              {series.map((s) => (
                <td key={s.name}>{shown(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
