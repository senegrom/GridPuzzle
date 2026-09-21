// Bounded numeric telemetry. Percentiles describe the latest 128 samples;
// count/mean/max describe the entire session. No images or free-form keys.
export function createMetricWindow(limit = 128) {
  limit = Number.isInteger(limit) && limit >= 1 ? Math.min(128, limit) : 128;
  let samples = [], at = 0, count = 0, total = 0, maximum = 0;
  const round = n => Math.round(n * 100) / 100;
  return {
    add(value) {
      if (!Number.isFinite(value) || value < 0 || value > 180000) return;
      count++; total += value; maximum = Math.max(maximum, value);
      samples[at] = value; at = (at + 1) % limit;
    },
    snapshot() {
      const sorted = [...samples].sort((a, b) => a - b), percentile = q => sorted.length ? round(sorted[Math.ceil(q * sorted.length) - 1]) : null;
      return { count, recentSamples: sorted.length, meanMilliseconds: count ? round(total / count) : null,
        maximumMilliseconds: count ? round(maximum) : null, p50Milliseconds: percentile(.5), p95Milliseconds: percentile(.95) };
    },
  };
}
