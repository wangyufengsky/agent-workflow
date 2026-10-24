/** A round step (1, 2 or 5 × 10ⁿ) that splits `span` into about four parts. */
function niceStep(span: number): number {
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  if (rough <= magnitude) return magnitude;
  if (rough <= 2 * magnitude) return 2 * magnitude;
  if (rough <= 5 * magnitude) return 5 * magnitude;
  return 10 * magnitude;
}

/** Round ticks (about four) from 0 to the first one at or above `max`. */
export function niceTicks(max: number): number[] {
  return niceRange(0, max);
}

/**
 * Round ticks covering `min`…`max` and always 0, so a line chart with negative values keeps its zero line (35 §5.2).
 */
export function niceRange(min: number, max: number): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (high === low) return [0];
  const step = niceStep(high - low);
  const first = Math.floor(low / step);
  const last = Math.ceil(high / step);
  // `+ 0` turns the -0 of a zero tick into 0.
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step + 0);
}
