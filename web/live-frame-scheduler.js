// New video frames drive image work; a separate heartbeat retires stale views.
// requestVideoFrameCallback metadata describes presentation, not sensor capture.
// https://wicg.github.io/video-rvfc/
export function createFrameScheduler({ video, onFrame, onHeartbeat = () => {},
  interval = () => 100, onError = () => {}, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false, generation = 0, callback = null, heartbeat = null;
  let native = false, token = null, lastSeen = -Infinity, lastProcessed = -Infinity;
  let observed = 0, processed = 0, skipped = 0, duplicates = 0;
  const boundedInterval = () => {
    const value = interval();
    return Number.isFinite(value) ? Math.max(100, Math.min(300, value)) : 100;
  };
  function fallbackToken() {
    // Prefer decoded/presented counts: currentTime alone may be less precise.
    try {
      const count = video.getVideoPlaybackQuality?.().totalVideoFrames;
      if (Number.isFinite(count) && count > 0) return `frames:${count}`;
    } catch { /* Use the next supported clock. */ }
    if (Number.isFinite(video.webkitDecodedFrameCount) && video.webkitDecodedFrameCount > 0)
      return `frames:${video.webkitDecodedFrameCount}`;
    return Number.isFinite(video.currentTime) ? `time:${video.currentTime}` : null;
  }
  function observe(value) {
    if (!video.videoWidth || !video.videoHeight || video.readyState === 0 || value === null) return;
    const [kind, count] = value.split(':'), [previousKind, previous] = (token ?? '').split(':');
    if (kind === previousKind && Number(count) <= Number(previous)) { duplicates++; return; }
    token = value; lastSeen = now(); observed++;
    if (lastSeen - lastProcessed < boundedInterval()) { skipped++; return; }
    lastProcessed = lastSeen; processed++;
    try { onFrame({ at: lastSeen }); } catch (error) { onError(error); }
  }
  function request(owner) {
    if (!running || owner !== generation || !native) return;
    try {
      callback = video.requestVideoFrameCallback((_time, metadata) => {
        if (!running || owner !== generation) return;
        callback = null;
        // Re-arm before client work, so errors do not silently stop the pump.
        request(owner);
        const value = Number.isFinite(metadata?.presentedFrames)
          ? `presented:${metadata.presentedFrames}`
          : Number.isFinite(metadata?.mediaTime) ? `media:${metadata.mediaTime}` : null;
        observe(value);
      });
    } catch {
      // An implemented-but-unusable API falls back without a busy loop.
      callback = null; native = false; token = null;
    }
  }
  function pulse(owner) {
    if (!running || owner !== generation) return;
    heartbeat = null;
    if (!native) observe(fallbackToken());
    try { onHeartbeat(); } catch (error) { onError(error); }
    if (running && owner === generation) heartbeat = setTimer(() => pulse(owner), 100);
  }
  return {
    start() {
      if (running) return;
      running = true; const owner = ++generation;
      token = null; lastSeen = lastProcessed = -Infinity;
      observed = processed = skipped = duplicates = 0;
      native = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function';
      request(owner); heartbeat = setTimer(() => pulse(owner), 100);
    },
    stop() {
      running = false; generation++;
      clearTimer(heartbeat); heartbeat = null;
      if (callback !== null) { try { video.cancelVideoFrameCallback(callback); } catch { /* already retired */ } }
      callback = null; lastSeen = -Infinity;
    },
    get fresh() { return running && now() - lastSeen <= 500; },
    get stats() { return { mode: native ? 'video-frame' : 'fallback', observed, processed, skipped, duplicates,
      intervalMilliseconds: boundedInterval(), fresh: running && now() - lastSeen <= 500 }; },
  };
}
