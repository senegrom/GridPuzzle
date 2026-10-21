import { createTrackingCore } from './live-tracking-core.js';
import { createPixelReader, REFUSALS } from './live-tracking-pixels.js';
const core = createTrackingCore(), pixelsOf = createPixelReader();
// The answer to the tracker's handshake (live-tracker.js): its 2 x 2 probe
// drawn and read back as every frame of the bitmap transport is. `pixels` is
// null without a refusal where this worker cannot draw at all (no
// OffscreenCanvas or 2D context). A probe it refuses as it would refuse such
// a frame says why (REFUSALS), with the values it read back if it read any
// (an alpha below 255 somewhere: fingerprinting noise, or a probe that drew
// nothing). Before, every such probe was answered as having no pixels, which
// the diagnostic report took for a worker without OffscreenCanvas.
function probeAnswer(bitmap) {
  try { return { pixels: Array.from(pixelsOf({ bitmap, width: 2, height: 2 }).data) }; } catch (error) {
    if (error?.undrawable) return { pixels: null };
    return { pixels: error?.pixels ? Array.from(error.pixels) : null, refusal: REFUSALS.includes(error?.refusal) ? error.refusal : 'failed' };
  }
}
self.onmessage = ({ data }) => {
  if (data?.op === 'probe') {
    self.postMessage({ probe: probeAnswer(data.bitmap) });
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
