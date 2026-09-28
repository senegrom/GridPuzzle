import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";

// A 3 x 3 grid of 100 px cells: strong clues in the corners, and whatever the
// case puts in the centre cell (4) on its own background.
function board({ paper = [245, 245, 245], cell4 = paper, mark = null, noise = 0 } = {}) {
  const width = 300, height = 300, data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return noise ? Math.round((seed / 2147483648 - 0.5) * 2 * noise) : 0; };
  const fill = (x, y, w, h, [r, g, b]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const at = 4 * (yy * width + xx), n = jitter();
      data[at] = r + n; data[at + 1] = g + n; data[at + 2] = b + n; data[at + 3] = 255;
    }
  };
  fill(0, 0, width, height, paper);
  fill(100, 100, 100, 100, cell4);
  for (const cell of [0, 2, 6, 8]) fill((cell % 3) * 100 + 45, Math.floor(cell / 3) * 100 + 26, 10, 50, [10, 10, 10]);
  // A bold, faint digit stroke: too shallow for the page-wide ink mask.
  if (mark) fill(143, 126, 14, 50, mark);
  return { width, height, data };
}
const centre = (prepared) => ({
  entry: prepared.entries.find((e) => e.cell === 4 && e.kind === "value"),
  unread: prepared.unreadCells.includes(4),
});

test("a faint digit on a dim photograph's paper is recovered for review", () => {
  const { entry } = centre(prepareScan(board({ paper: [120, 120, 120], mark: [100, 100, 100] }), "latinsquare", 3, 3));
  assert.ok(entry, "the dim page's faint digit must not fall through as an empty cell");
  assert.equal(entry.recoveredMark, true, "a recovered mark is always reviewed");
});
test("the same faint digit on bright paper was and is recovered", () => {
  const { entry } = centre(prepareScan(board({ mark: [225, 225, 225] }), "latinsquare", 3, 3));
  assert.equal(entry?.recoveredMark, true);
});
test("a shaded panel on a bright page is still not read as a mark", () => {
  const { entry, unread } = centre(prepareScan(board({ cell4: [130, 130, 130], mark: [110, 110, 110] }), "latinsquare", 3, 3));
  assert.equal(entry, undefined); assert.equal(unread, false);
});
test("pale coloured print is found through its darkest channel", () => {
  // Pink on light grey: shallow in luminance, deep in the green and blue channels.
  const { entry } = centre(prepareScan(board({ paper: [205, 205, 205], mark: [250, 165, 165] }), "latinsquare", 3, 3));
  assert.equal(entry?.recoveredMark, true);
});
test("grainy empty cells on a dim page, or a coloured highlight, stay empty", () => {
  for (const options of [{ paper: [120, 120, 120], noise: 5 }, { cell4: [255, 240, 60] }, { paper: [120, 120, 120], cell4: [60, 140, 220] }]) {
    const { entry, unread } = centre(prepareScan(board(options), "latinsquare", 3, 3));
    assert.equal(entry, undefined, JSON.stringify(options)); assert.equal(unread, false, JSON.stringify(options));
  }
});
