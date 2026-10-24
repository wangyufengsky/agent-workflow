import { useState } from 'react';
import { ringArcs, sharePercents } from './chart-math.ts';
import styles from './charts.module.css';
import { toneClass, toneOf } from './series.ts';

/** A circle of circumference 100 in a 42 × 42 box: a slice's dash length is its share in percent. */
const RADIUS = 100 / (2 * Math.PI);
const CENTER = 21;

/**
 * A ring of slices with the total in the middle and a legend of values and shares (35 §5.2). Hovering or focusing a
 * legend item brings its slice forward and reads it out; a visually hidden table carries the numbers.
 */
export function DonutChart({
  label,
  categories,
  values,
  seriesName,
  format,
  columnHeader,
  shareHeader,
  formatShare,
  tableCaption,
}: {
  label: string;
  categories: readonly string[];
  values: readonly number[];
  seriesName: string;
  format: (value: number) => string;
  columnHeader: string;
  shareHeader: string;
  formatShare: (percent: number) => string;
  tableCaption: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = values.reduce((sum, v) => sum + v, 0);
  const shares = sharePercents(values);
  const slices = ringArcs(values).map((arc, i) => ({ ...arc, tone: toneOf(i) }));
  const readout = (i: number) => [categories[i], format(values[i] ?? 0), formatShare(shares[i] ?? 0)].join(' · ');

  return (
    <figure className={styles.chart} aria-label={label}>
      {/* The legend shows every value and the ring highlights the slice; the readout is for screen readers. */}
      <figcaption className="sr" aria-live="polite">
        {active === null ? null : readout(active)}
      </figcaption>
      <div className={styles.pie}>
        <div className={styles.ring} data-active={active === null ? undefined : ''}>
          <svg viewBox="0 0 42 42" aria-hidden="true">
            <circle className={styles.ringTrack} cx={CENTER} cy={CENTER} r={RADIUS} />
            {slices.map((slice, i) =>
              slice.value === 0 ? null : (
                <circle
                  key={categories[i]}
                  className={toneClass(slice.tone)}
                  data-active={active === i ? '' : undefined}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  strokeDasharray={`${slice.length} ${100 - slice.length}`}
                  strokeDashoffset={slice.offset}
                />
              ),
            )}
          </svg>
          <div className={styles.total} aria-hidden="true">
            <strong>{format(total)}</strong>
            <span>{seriesName}</span>
          </div>
        </div>
        <ul className={styles.slices}>
          {categories.map((category, i) => (
            <li key={category}>
              <button
                type="button"
                className={styles.slice}
                aria-label={readout(i)}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <i className={`${styles.swatch} ${toneClass(toneOf(i))}`} aria-hidden="true" />
                <span className={styles.sliceName} title={category}>
                  {category}
                </span>
                <span className={styles.sliceValue}>{format(values[i] ?? 0)}</span>
                <span className={styles.slicePercent}>{formatShare(shares[i] ?? 0)}</span>
                <span className={styles.shareTrack} aria-hidden="true">
                  <i
                    className={`${styles.shareFill} ${toneClass(toneOf(i))}`}
                    style={{ width: `${shares[i] ?? 0}%` }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <table className="sr">
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th>{columnHeader}</th>
            <th>{seriesName}</th>
            <th>{shareHeader}</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category, i) => (
            <tr key={category}>
              <td>{category}</td>
              <td>{format(values[i] ?? 0)}</td>
              <td>{formatShare(shares[i] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
