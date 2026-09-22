// A repeated worker crash must not become an unbounded restart loop. Count
// sustained verified work, including the camera's supported delayed tier.
// An empty reply, a single success after a long gap, or repeated timestamps
// cannot forgive earlier failures. Display age/identity checks remain in the
// camera; this helper never authorizes an overlay.
export function createTrackingRecovery({ now = () => performance.now() } = {}) {
  let failures = 0, next = 0, goodSince = null, lastGood = -Infinity, successes = 0;
  return {
    fail() {
      goodSince = null; lastGood = -Infinity; successes = 0;
      failures = Math.min(3, failures + 1);
      next = failures >= 3 ? Infinity : now() + 2000 * 2 ** (failures - 1);
    },
    succeeded() {
      const time = now();
      if (failures >= 3 || time <= lastGood) return;
      // The camera accepts verified snapshots up to 2000ms old. A valid
      // 1-second worker cadence must not continually reset this success run.
      if (time - lastGood > 2000) { goodSince = time; successes = 0; }
      lastGood = time; successes++;
      if (successes >= 3 && goodSince !== null && time - goodSince >= 2000) { failures = 0; next = 0; }
    },
    reset() { failures = 0; next = 0; goodSince = null; lastGood = -Infinity; successes = 0; },
    get nextAttempt() { return next; },
    get blocked() { return failures >= 3; },
    get stats() { return { failures, blocked: failures >= 3, retryInMilliseconds: Number.isFinite(next) ? Math.max(0, next - now()) : null }; },
  };
}
