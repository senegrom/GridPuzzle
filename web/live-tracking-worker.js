import { createTrackingCore } from './live-tracking-core.js';
import { createPixelReader } from './live-tracking-pixels.js';
const core = createTrackingCore(), pixelsOf = createPixelReader();
self.onmessage = ({ data }) => {
  // The tracker's handshake (live-tracker.js): its 2 x 2 probe drawn and read
  // back as every frame of the bitmap transport is; null where that fails.
  if (data?.op === 'probe') {
    let pixels = null;
    try { pixels = Array.from(pixelsOf({ bitmap: data.bitmap, width: 2, height: 2 }).data); } catch { /* the ImageData transport */ }
    self.postMessage({ probe: { pixels } });
    return;
  }
  // A frame arrives as the camera's own readback (image) or as a bitmap of
  // its snapshot, read back here. `milliseconds` is the tracking core's time
  // alone, which paces the camera's frames; `transportMilliseconds` the draw
  // and readback of a bitmap.
  const started = performance.now();
  let image;
  try { image = data.bitmap ? pixelsOf(data) : data.image; } catch {
    self.postMessage({ id: data.id, error: 'bitmap-unsupported' });
    return;
  }
  const read = performance.now();
  try {
    const result = core.run({ ...data, image });
    self.postMessage({ id: data.id, result, milliseconds: performance.now() - read, transportMilliseconds: read - started });
  } catch (error) {
    self.postMessage({ id: data.id, error: error?.message || 'Tracking failed.' });
  }
};
// The worker has loaded: the handshake's wait for the probe starts here.
self.postMessage({ started: true });
