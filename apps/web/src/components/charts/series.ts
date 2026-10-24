import styles from './charts.module.css';

/** Series colours: theme tokens by position (charts.module.css `.s0`…`.s7`), and a neutral one for the rest. */
export const SERIES_TONES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;
export type SeriesTone = (typeof SERIES_TONES)[number] | 'sRest';

/** A series' colour by position (members in name order, slices in category order); the rest share a neutral one. */
export const toneOf = (index: number): SeriesTone => SERIES_TONES[index] ?? 'sRest';

/** The class that colours an element with a series' tone: its background, and `--tone` for SVG strokes. */
export const toneClass = (tone: SeriesTone) => styles[tone];

/** A named series of values in category order, with its colour; null is a gap (line charts only). */
export type ChartSeries = { name: string; tone: SeriesTone; values: readonly (number | null)[] };
