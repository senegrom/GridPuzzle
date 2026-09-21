// A repeated worker crash must not become an unbounded restart loop. Reset the
// failure streak only after sustained verified work, not an empty queue reply.
export function createTrackingRecovery({ now = () => performance.now() } = {}) {
  let failures = 0, next = 0, goodSince = null, lastGood = -Infinity;
  return {
    fail() {
      goodSince = null; lastGood = -Infinity;
      failures = Math.min(3, failures + 1);
      next = failures >= 3 ? Infinity : now() + 2000 * 2 ** (failures - 1);
    },
    succeeded() {
      const time = now();
      if (time - lastGood > 500) goodSince = time;
      lastGood = time;
      if (goodSince !== null && time - goodSince >= 2000) { failures = 0; next = 0; }
    },
    reset() { failures = 0; next = 0; goodSince = null; lastGood = -Infinity; },
    get nextAttempt() { return next; },
    get blocked() { return failures >= 3; },
    get stats() { return { failures, blocked: failures >= 3, retryInMilliseconds: Number.isFinite(next) ? Math.max(0, next - now()) : null }; },
  };
}
