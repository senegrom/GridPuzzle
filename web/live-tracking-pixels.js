// The tracking worker's half of the bitmap transport (live-tracker.js). The
// camera's snapshot arrives as a transferred ImageBitmap; it is drawn at the
// tracking size into one reused OffscreenCanvas and read back here, so the
// main thread neither scales it nor reads it back. The drawing is the main
// thread's own readback (contentPixels in live-camera.js): a cleared canvas,
// CPU-backed where the browser honours willReadFrequently, the default
// smoothing, the whole bitmap over the whole canvas. Whatever cannot be read
// back so throws, which the worker answers with "bitmap-unsupported": that
// frame is lost (REFUSAL_LIMIT in live-tracker.js).
// A snapshot of the camera's picture is opaque, so a readback with any
// transparent pixel is a bitmap that drew nothing there (a buffer lost on its
// way, say) or a snapshot of a video that had no picture to draw: tracked, it
// would give an anchor with nothing in it, which every later blank frame
// matches. It is checked at 9 × 9 points spread over it, its corners included.
function opaque({ width, height, data }) {
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const x = Math.round(j * (width - 1) / 8), y = Math.round(i * (height - 1) / 8);
    if (data[4 * (y * width + x) + 3] !== 255) return false;
  }
  return true;
}
export function createPixelReader(makeCanvas = (width, height) => new OffscreenCanvas(width, height)) {
  let canvas = null;
  return function pixelsOf({ bitmap, width, height }) {
    try {
      // A bitmap that did not arrive whole: WebKit delivers one it could not
      // move to this thread as null (from iOS 18) or as 0 × 0 (iOS 16.4 to
      // 17), and a snapshot's bitmap is never smaller than its tracking pixels.
      if (!(bitmap?.width >= width && bitmap?.height >= height)) throw Error("The bitmap did not arrive whole.");
      canvas ??= makeCanvas(width, height);
      // Assigning a size resets the canvas, so only a new size is assigned.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw Error("No 2D canvas in the tracking worker.");
      // A snapshot that drew nothing must not leave the previous frame's pixels.
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      if (!opaque(image)) throw Error("The bitmap drew nothing.");
      return image;
    } finally {
      // The bitmap was transferred here: it is closed on every path.
      bitmap?.close?.();
    }
  };
}
