// The tracking worker's half of the bitmap transport (live-tracker.js). The
// camera's snapshot arrives as a transferred ImageBitmap; it is drawn at the
// tracking size into one reused OffscreenCanvas and read back here, so the
// main thread neither scales it nor reads it back. The drawing is the main
// thread's own readback (contentPixels in live-camera.js): a cleared canvas,
// CPU-backed where the browser honours willReadFrequently, the default
// smoothing, the whole bitmap over the whole canvas.
export function createPixelReader(makeCanvas = (width, height) => new OffscreenCanvas(width, height)) {
  let canvas = null;
  return function pixelsOf({ bitmap, width, height }) {
    try {
      canvas ??= makeCanvas(width, height);
      // Assigning a size resets the canvas, so only a new size is assigned.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw Error("No 2D canvas in the tracking worker.");
      // A snapshot that drew nothing must not leave the previous frame's pixels.
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    } finally {
      // The bitmap was transferred here: it is closed on every path.
      bitmap?.close?.();
    }
  };
}
