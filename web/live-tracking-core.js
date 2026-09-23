import { gridAnchor, matchGrid } from './live-registration.js';

// Worker-owned anchors. Main-thread objects contain opaque IDs and proofs,
// never the grayscale raster, feature patches or content-comparison arrays.
// Even a perfect geometric fit still goes through matchGrid's content guard.
export function createTrackingCore() {
  const anchors = new Map();
  let serial = 0;
  function imageOK(image) {
    const { width, height, data } = image ?? {};
    return Number.isInteger(width) && Number.isInteger(height) && width >= 16 && height >= 16 &&
      width <= 1280 && height <= 1280 && data instanceof Uint8ClampedArray && data.length === width * height * 4;
  }
  const ids = value => Array.isArray(value) && value.length <= 6 &&
    value.every(id => Number.isSafeInteger(id) && id > 0) ? [...new Set(value)] : [];
  return {
    run(task) {
      if (!imageOK(task.image)) throw Error('Invalid tracking frame.');
      const keep = ids(task.anchors);
      if (task.op === 'anchor') {
        const anchor = gridAnchor(task.image, task.corners, task.rows, task.cols);
        if (!anchor) return { anchor: null };
        const matches = {};
        for (const id of keep) {
          const old = anchors.get(id);
          matches[id] = !!(old && old.rows === task.rows && old.cols === task.cols &&
            matchGrid(old, task.image, task.corners));
        }
        // Registration only uses dimensions after the anchor was built. Keep
        // one-byte grayscale pixels, not another four-byte camera-frame copy.
        anchor.image = { width: task.image.width, height: task.image.height };
        const id = ++serial;
        anchors.set(id, anchor);
        while (anchors.size > 8) {
          const victim = [...anchors.keys()].find(key => key !== id && !keep.includes(key));
          anchors.delete(victim);
        }
        return { anchor: { id, matches, corners: anchor.corners }, retained: anchors.size };
      }
      if (task.op !== 'verify') throw Error('Unknown tracking operation.');
      const proofs = {}, rejections = {};
      for (const id of keep) {
        const diagnostic = {}, anchor = anchors.get(id),
          match = anchor && matchGrid(anchor, task.image, anchor.hint ?? anchor.corners, diagnostic);
        if (match) anchor.hint = match.corners;
        else rejections[id] = anchor ? diagnostic : { reason: 'missing-anchor' };
        proofs[id] = match ? { corners: match.corners } : null;
      }
      return { proofs, rejections, retained: anchors.size };
    },
    get size() { return anchors.size; },
  };
}
