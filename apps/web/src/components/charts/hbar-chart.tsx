import { useState } from 'react';
import styles from './charts.module.css';
import { type SeriesTone, toneClass } from './series.ts';

export type HBarSeries = { name: string; tone: SeriesTone; values: readonly number[] };

/**
 * Horizontal bars: the category's name left, its bar, its value right (35 §5.2); long names read better than under
 * columns. The hovered or focused row is read out above; a visually hidden table carries the numbers.
 */
export function HBarChart({
  label,
  categories,
  series,
  stacked,
  format,
  columnHeader,
  tableCaption,
}: {
  label: string;
  categories: readonly string[];
  series: readonly HBarSeries[];
  stacked: boolean;
  format: (value: number) => string;
  columnHeader: string;
  tableCaption: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const valuesAt = (i: number) => series.map((s) => s.values[i] ?? 0);
  const reach = (i: number) => (stacked ? valuesAt(i).reduce((sum, v) => sum + v, 0) : Math.max(0, ...valuesAt(i)));
  const top = Math.max(0, ...categories.map((_, i) => reach(i)));
  const width = (value: number) => (top === 0 ? 0 : (value / top) * 100);
  const readout = (i: number) =>
    [categories[i], ...series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`)].join(' · ');
  const showValue = stacked || series.length === 1;

  return (
    <figure className={styles.chart} aria-label={label}>
      <figcaption className={styles.readout} aria-live="polite">
        {active !== null ? (
          <span className={styles.value}>{readout(active)}</span>
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
      <div className={styles.rows}>
        {categories.map((category, i) => (
          <button
            key={category}
            type="button"
            className={styles.row}
            aria-label={readout(i)}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <span className={styles.rowLabel} title={category}>
              {category}
            </span>
            <span className={styles.track} data-stacked={stacked ? '' : undefined}>
              {series.map((s) => (
                <i key={s.name} className={toneClass(s.tone)} style={{ width: `${width(s.values[i] ?? 0)}%` }} />
              ))}
            </span>
            <span className={styles.rowValue}>{showValue ? format(reach(i)) : ''}</span>
          </button>
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
                <td key={s.name}>{format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
