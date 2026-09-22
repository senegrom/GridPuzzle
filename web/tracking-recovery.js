// Both delayed display and sustained worker recovery accept verified snapshots
// only within this age. Slow verified work is not a series of isolated replies.
export const MAX_VERIFIED_TRACK_AGE = 2000;

// A repeated worker crash must not become an unbounded restart loop. Reset the
// failure streak only after sustained verified work, not an empty queue reply.
export function createTrackingRecovery({ now = () => performance.now() } = {}) {
  let failures = 0, next = 0, goodSince = null, lastGood = -Infinity, goodSamples = 0;
  return {
    fail() {
      goodSince = null; lastGood = -Infinity; goodSamples = 0;
      failures = Math.min(3, failures + 1);
      next = failures >= 3 ? Infinity : now() + 2000 * 2 ** (failures - 1);
    },
    succeeded() {
      const time = now();
      // A late or duplicate reply cannot bypass a pause or a backoff deadline.
      if (!Number.isFinite(time) || failures >= 3 || time < next || time <= lastGood) return;
      if (goodSince === null || time - lastGood > MAX_VERIFIED_TRACK_AGE) {
        goodSince = time; goodSamples = 0;
      }
      lastGood = time; goodSamples++;
      if (goodSamples >= 3 && time - goodSince >= 2000) { failures = 0; next = 0; }
    },
    reset() { failures = 0; next = 0; goodSince = null; lastGood = -Infinity; goodSamples = 0; },
    get nextAttempt() { return next; },
    get blocked() { return failures >= 3; },
    get stats() { return { failures, blocked: failures >= 3, retryInMilliseconds: Number.isFinite(next) ? Math.max(0, next - now()) : null }; },
  };
}
