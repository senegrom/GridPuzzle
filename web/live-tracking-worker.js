import { createTrackingCore } from './live-tracking-core.js';
import { createPixelReader, REFUSALS } from './live-tracking-pixels.js';
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
  // its snapshot, read back here. A bitmap job whose bitmap arrived as null
  // (WebKit could not move it here) cannot be read back: it is answered as
  // such, with why (REFUSALS), not tracked as a frame without pixels.
  // `milliseconds` is the tracking core's time alone, which paces the
  // camera's frames; `transportMilliseconds` the draw and readback of a bitmap.
  const started = performance.now();
  let image;
  try { image = 'bitmap' in data ? pixelsOf(data) : data.image; } catch (error) {
    self.postMessage({ id: data.id, error: 'bitmap-unsupported', refusal: REFUSALS.includes(error?.refusal) ? error.refusal : 'failed' });
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
