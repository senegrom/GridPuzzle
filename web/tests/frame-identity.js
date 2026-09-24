// Test-only frame identity: production compares worker proofs, not thumbnails.
// Local blocks as well as the whole signature: a changed clue or a finger over
// one area differs even when the total difference is small.
function sameFrame(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return false;
  let total = 0;
  for (let i = 0; i < a.length; i += 64) {
    let local = 0;
    for (let j = i; j < Math.min(a.length, i + 64); j++) local += Math.abs(a[j] - b[j]);
    if (local / Math.min(64, a.length - i) > 16) return false;
    total += local;
  }
  return total / a.length < 6;
}

// The frame identity a session had before the camera owned it, for tests that
// model motion with fingerprints: a frame is current while its fingerprint
// matches the last observed or moved-to one, and two frames show the same
// scene when their fingerprints and corners agree. `track()` wraps a session
// so its observe() and motion() keep that fingerprint, as the old built-in
// fallback did. Production injects the worker's proofs instead.
export function signatureIdentity() {
  let current = null;
  const isCurrent = frame => sameFrame(frame.signature, current ?? frame.signature) ? { corners: frame.corners } : false;
  const sameScene = (a, b) => sameFrame(a.signature, b.signature) && a.corners.every((p, i) =>
    Math.hypot(p.x - b.corners[i].x, p.y - b.corners[i].y) <= b.width * .012);
  const track = session => new Proxy(session, {
    get(target, key) {
      if (key === "observe") return frame => { current = frame.signature; target.observe(frame); };
      if (key === "motion") return signature => { current = signature; target.motion(signature); };
      return Reflect.get(target, key, target);
    },
  });
  return { isCurrent, sameScene, track };
}
