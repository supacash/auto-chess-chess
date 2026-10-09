/**
 * 95% margins of error for simulator tables, so small differences aren't over-read.
 * Games within one run aren't fully independent (same army carried forward), so treat these as
 * slightly optimistic.
 */

const Z95 = 1.96;

/** Half-width of the 95% interval for a proportion `x / n`, in percentage points (normal approximation). */
export function proportionMargin(x: number, n: number): number {
  if (n === 0) return NaN;
  const p = x / n;
  // Use p = 0.5 at the extremes so 0% or 100% from a small sample doesn't claim ±0.
  const q = p === 0 || p === 1 ? 0.5 : p;
  return 100 * Z95 * Math.sqrt((q * (1 - q)) / n);
}

/** Half-width of the 95% interval for the mean of `values`. */
export function meanMargin(values: number[]): number {
  const n = values.length;
  if (n < 2) return NaN;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Z95 * Math.sqrt(variance / n);
}

/** "±4" style label for a proportion margin, or "-" when there is no data. */
export function formatMargin(x: number, n: number): string {
  const m = proportionMargin(x, n);
  return Number.isNaN(m) ? '-' : `±${Math.round(m)}`;
}
