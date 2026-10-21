// How a reading shows which way up its page lies: the cues the still
// photograph's check goes by (Scanner.orient, scanner.js) and the live
// view's help line names (live-session.js, turnedPage). They are kept out
// of scanner.js so that page modules can use them while a recognition
// suite runs the page with an older scanner.js (scripts/harness.cjs,
// baselineSite).

// Cells whose digit carries no review flag: what a reading has to offer. A
// digit highlighted only for its size still counts, since it was read clearly.
function confidentValues(found) {
  const uncertain = new Set(found.uncertain ?? []), noteSized = new Set(found.noteSized ?? []);
  return found.puzzle.cells.filter((value, cell) => Number.isInteger(value) && (!uncertain.has(cell) || noteSized.has(cell)));
}
export function confidentDigits(found) {
  return confidentValues(found).length;
}
// Of those, the numbers that show which way up the page is: any with a 2, 3
// or 5. Read upside down, 0s, 1s and most 8s read as themselves, 6s and 9s as
// each other, most 2s as 4s and many 4s as 7s, all with confidence, but a
// number with a 2, 3 or 5 reads with confidence only a 27th as often as on the
// same page upright (web/OCR_QUALITY.md, "Half turns").
export function wayUpDigits(found) {
  return confidentValues(found).filter((value) => /[235]/.test(String(value))).length;
}
// Scanner.halfTurn keeps a reading taken half a turn round only with at least
// HALF_TURN_BAR such numbers, and only when it also reads clearly better than
// the first: more confident digits, and at least HALF_TURN_FLOOR of them (or
// half its value regions, on a page with fewer clues). Upside down, some
// handwriting fonts read an upright page's 8s, 3s or 5s as confident 3s and
// 5s, so those numbers alone can turn an upright page; but every such reading
// measured had fewer confident digits than the upright one, or 9 at most.
export const HALF_TURN_BAR = 5;
export const HALF_TURN_FLOOR = 12;
// Median height/width of single, clue-sized value glyphs (at least half the
// 75th-percentile height): about 1.4 upright, under 0.75 a quarter turn away.
// Infinity without six such glyphs, which is no evidence either way; exactly
// 1 when the middle box is a whole cell (Kakuro entries, cell-filling blobs),
// which is none either.
export function glyphAspect(values) {
  const heights = values.map((e) => e.h).sort((a, b) => a - b);
  if (heights.length < 6) return Infinity;
  const reference = heights[Math.floor(0.75 * (heights.length - 1))],
    ratios = values.filter((e) => !(e.glyphCount > 1) && e.h >= 0.5 * reference && e.w >= 0.3 * reference)
      .map((e) => e.h / e.w).sort((a, b) => a - b);
  return ratios.length < 6 ? Infinity : ratios[ratios.length >> 1];
}
