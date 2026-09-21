// New video frames drive image work; a separate heartbeat retires stale views.
// requestVideoFrameCallback metadata describes presentation, not sensor capture.
// https://wicg.github.io/video-rvfc/
export function createFrameScheduler({ video, onFrame, onHeartbeat = () => {},
  interval = () => 100, onError = () => {}, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false, generation = 0, callback = null, heartbeat = null;
  let native = false, lastNative = -Infinity, probeToken = null, probeAdvances = 0, fallbacks = 0, token = null, lastSeen = -Infinity, lastProcessed = -Infinity;
  let observed = 0, processed = 0, skipped = 0, duplicates = 0;
  const boundedInterval = () => {
    const value = interval();
    return Number.isFinite(value) ? Math.max(100, Math.min(300, value)) : 100;
  };
  function fallbackToken() {
    // Prefer decoded/presented counts: currentTime alone may be less precise.
    try {
      const quality = video.getVideoPlaybackQuality?.();
      // totalVideoFrames includes dropped frames. Discard those so a decoder
      // that never presents its frames cannot keep the overlay fresh.
      const count = quality?.totalVideoFrames - (quality?.droppedVideoFrames ?? 0);
      if (Number.isFinite(count) && count > 0) return `frames:${count}`;
    } catch { /* Use the next supported clock. */ }
    if (Number.isFinite(video.webkitDecodedFrameCount) && video.webkitDecodedFrameCount > 0)
      return `frames:${video.webkitDecodedFrameCount}`;
    return Number.isFinite(video.currentTime) ? `time:${video.currentTime}` : null;
  }
  function observe(value) {
    if (!video.videoWidth || !video.videoHeight || video.readyState === 0 || video.paused === true || video.ended === true || value === null) return;
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
        if (!running || owner !== generation || !native) return;
        callback = null;
        // Re-arm before client work, so errors do not silently stop the pump.
        request(owner);
        const value = Number.isFinite(metadata?.presentedFrames)
          ? `presented:${metadata.presentedFrames}`
          : Number.isFinite(metadata?.mediaTime) ? `media:${metadata.mediaTime}` : null;
        const seen = observed;
        observe(value);
        if (observed !== seen) { lastNative = now(); probeAdvances = 0; }
      });
    } catch {
      // An implemented-but-unusable API falls back without a busy loop.
      callback = null; native = false; token = null;
    }
  }
  function pulse(owner) {
    if (!running || owner !== generation) return;
    heartbeat = null;
    const evidence = fallbackToken();
    if (native) {
      // A successfully registered callback may silently stop. Two independent
      // advances after the native proof expires permit fallback; elapsed time
      // or a media clock alone is not evidence that a frame was presented.
      const count = evidence?.startsWith('frames:') ? Number(evidence.slice(7)) : null;
      if (Number.isFinite(count) && video.paused !== true && video.ended !== true) {
        const advanced = probeToken !== null && count > probeToken;
        if (advanced && now() - lastNative > 500) probeAdvances++;
        else if (probeToken !== null && count < probeToken) probeAdvances = 0;
        probeToken = count;
        if (advanced && now() - lastNative >= 1000 && probeAdvances >= 2) {
          native = false; fallbacks++; token = null;
          if (callback !== null) { try { video.cancelVideoFrameCallback(callback); } catch { /* fenced below */ } }
          callback = null;
        }
      } else { probeToken = null; probeAdvances = 0; }
    }
    if (!native) observe(evidence);
    try { onHeartbeat(); } catch (error) { onError(error); }
    if (running && owner === generation) heartbeat = setTimer(() => pulse(owner), 100);
  }
  return {
    start() {
      if (running) return;
      running = true; const owner = ++generation;
      token = null; lastSeen = lastProcessed = -Infinity;
      observed = processed = skipped = duplicates = fallbacks = 0;
      lastNative = now(); probeToken = null; probeAdvances = 0;
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
      intervalMilliseconds: boundedInterval(), fallbacks, callbackStalled: native && now() - lastNative >= 1000, fresh: running && now() - lastSeen <= 500 }; },
  };
}
