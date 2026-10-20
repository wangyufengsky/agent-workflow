/** Arithmetic mean of the values. */
export function average(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Middle value of the sorted values; the mean of the two middle values when there is an even number of them. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort();
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
