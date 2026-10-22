// How a reading shows which way up its page lies: the cues the still
// photograph's check goes by (Scanner.orient, scanner.js, and a capture's
// handoff to the editor, photo-flow.js) and the live view's help line names
// (live-session.js, turnedPage), and for a cage puzzle its cage sums
// (Scanner.cageTurn). They are kept out of scanner.js so that page
// modules can use them while a recognition suite runs the page with an older
// scanner.js (scripts/harness.cjs, baselineSite).

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
// The turn a reading's own evidence asks Scanner.orient to try: none for a
// reading with confident digits in at least half its value regions; for a
// poorer one, "quarter" when its glyphs are wider than tall, and "half" when
// they are taller than wide and it reads confident digits but none that shows
// the way up (Scanner.halfTurn). A reading without six measurable glyphs, or
// whose glyphs are as tall as wide, asks for none.
export function turnCue(found) {
  const values = (found.entries ?? []).filter((e) => e.kind === "value"),
    confident = confidentDigits(found);
  if (confident >= values.length / 2) return null;
  const aspect = glyphAspect(values);
  if (aspect > 1 && aspect < Infinity) return confident && !wayUpDigits(found) ? "half" : null;
  return aspect < 1 ? "quarter" : null;
}

// A cage puzzle (Killer, KenKen) shows which way up it is by its cage sums,
// not its digits: every digit read on a cage board is under review
// (puzzleFromReadings), so confidentDigits is 0 there however the page lies.
// Each sum is printed in the top-left corner of its cage's top-left cell,
// where the reader looks for it (CAGE_LABEL_BOX in scan-analysis.js). Turned,
// the page puts every sum in another corner, mostly of another cell, so the
// reader finds few sums, and the page read turned the right way finds them.
// A sum counts only when its cage can hold it (`cageSum`), since the empty
// corners a turned page offers still catch strokes that read as numbers.
function primeFactorsAtMost(value, n) {
  let rest = value;
  for (let p = 2; p * p <= rest; p++) while (rest % p === 0) { if (p > n) return false; rest /= p; }
  return rest <= n;
}
// A target the cage can hold in an n x n puzzle of its type: a Killer cage's
// distinct digits from 1 to n, a KenKen cage's digits from 1 to n by its
// operator ("-" and "/" on two cells only).
export function cageSum(cage, type, n) {
  const k = cage.cells?.length ?? 0, target = cage.target;
  if (!k || !Number.isSafeInteger(target) || target <= 0) return false;
  if (type === "killersudoku") return k <= n && target >= (k * (k + 1)) / 2 && target <= (k * (2 * n + 1 - k)) / 2;
  if (k === 1) return target <= n;
  switch (cage.op ?? "+") {
    case "+": return target >= k && target <= k * n;
    case "-": return k === 2 && target <= n - 1;
    case "/": return k === 2 && target >= 2 && target <= n;
    case "*": return target <= n ** k && primeFactorsAtMost(target, n);
    default: return false;
  }
}
// The cages of a cage puzzle's reading (one clue region each) and the number
// of them whose sum was read and can stand (cageSum).
export function cageSums(found) {
  const { type, rows } = found.puzzle ?? {};
  return {
    cages: (found.entries ?? []).filter((e) => e.cageLabel).length,
    sums: (found.puzzle?.cages ?? []).filter((cage) => cageSum(cage, type, rows)).length,
  };
}
// Scanner.cageTurn reads a cage puzzle again turned when fewer than half its
// cages have a sum that can stand, and keeps a turned reading only when it
// reads at least CAGE_TURN_FLOOR such sums, sums in at least half its cages,
// and more than twice as many as the first reading.
export const CAGE_TURN_FLOOR = 3;
