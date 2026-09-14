/* Semantic scanner scoring. Independent of Playwright, the corpus and OCR.
   Counts observations, not distinct Map keys: duplicates are extra readings.
   Topology errors are separate from the printed-clue accuracy denominator. */
function cageOperator(cage) {
  const aliases = { "×": "*", x: "*", X: "*", "÷": "/", "−": "-" };
  const op = cage.op || "+", normalized = aliases[op] || op;
  return cage.cells.length === 1 && normalized === "=" ? "+" : normalized;
}

function score(target, reading) {
  const truth = target.puzzle.cells, read = reading.read.cells;
  const flagged = new Set(reading.uncertain || []);
  const structural = new Set(reading.cageUncertain || []);
  const result = { printed: 0, correct: 0, wrong: 0, missed: 0, invented: 0, unsafe: 0,
    topologyWrong: 0, topologyUnsafe: 0, shapeErrors: Math.abs(truth.length - read.length) };
  const unflagged = (cells) => !cells.some(cell => flagged.has(cell) || structural.has(cell));
  function compare(wanted, got, key, same, cells) {
    const remaining = new Map();
    for (const item of got) {
      const id = key(item);
      if (!remaining.has(id)) remaining.set(id, []);
      remaining.get(id).push(item);
    }
    for (const item of wanted) {
      result.printed++;
      const matches = remaining.get(key(item)) || [];
      // Prefer an exact match regardless of observation order. Leave duplicate
      // or contradictory readings in the bucket to be counted as invented.
      const exact = matches.findIndex(candidate => same(item, candidate));
      if (exact >= 0) { matches.splice(exact, 1); result.correct++; continue; }
      if (matches.length) { matches.shift(); result.wrong++; } else result.missed++;
      if (unflagged(cells(item))) result.unsafe++;
    }
    for (const matches of remaining.values()) for (const item of matches) {
      result.invented++;
      if (unflagged(cells(item))) result.unsafe++;
    }
  }
  const kind = target.puzzle.type;
  if (kind === "kakuro") {
    compare(target.puzzle.clues || [], reading.read.clues || [], item => item.cell,
      (a, b) => (a.across ?? null) === (b.across ?? null) && (a.down ?? null) === (b.down ?? null),
      item => [item.cell]);
  } else if (kind === "killersudoku" || kind === "kenken") {
    compare(target.puzzle.cages || [], reading.read.cages || [],
      item => JSON.stringify([...item.cells].sort((a, b) => a - b)),
      (a, b) => a.target === b.target && cageOperator(a) === cageOperator(b), item => item.cells);
  } else if (kind === "futoshiki") {
    compare(target.puzzle.inequalities || [], reading.read.inequalities || [],
      item => JSON.stringify([item.less, item.greater].sort((a, b) => a - b)),
      (a, b) => a.less === b.less && a.greater === b.greater, item => [item.less, item.greater]);
  }
  const wantedBlack = new Set(target.puzzle.black || []), gotBlack = new Set(reading.read.black || []);
  truth.forEach((value, cell) => {
    const got = read[cell];
    const blocked = kind === "str8ts" ? wantedBlack.has(cell) : value === "#";
    const readBlocked = kind === "str8ts" ? gotBlack.has(cell) : got === "#";
    // A Str8ts # without a black-list entry is malformed, not an empty white
    // cell. Numbered black/white changes matter even when the digit is right.
    if (blocked !== readBlocked || (kind === "str8ts" && got === "#" && !readBlocked)) {
      result.topologyWrong++;
      if (unflagged([cell])) { result.topologyUnsafe++; result.unsafe++; }
    }
    if (Number.isInteger(value)) {
      result.printed++;
      if (got === value) { result.correct++; return; }
      if (got === null || got === undefined) result.missed++; else result.wrong++;
      if (!flagged.has(cell)) result.unsafe++;
    } else if (Number.isInteger(got)) {
      // A digit hallucinated on a blocked cell is still an invented digit.
      result.invented++;
      if (!flagged.has(cell)) result.unsafe++;
    }
  });
  if (target.corners && reading.corners) {
    const size = Math.hypot(target.corners[2][0] - target.corners[0][0],
      target.corners[2][1] - target.corners[0][1]) || 1;
    const distance = target.corners.reduce((sum, [x, y], index) =>
      sum + Math.hypot(x - reading.corners[index][0], y - reading.corners[index][1]), 0) / 4;
    result.cornerError = Math.round((distance / size) * 1000) / 10;
  }
  return result;
}

function isPerfect(result) {
  return !result.error && result.printed > 0 && result.correct === result.printed &&
    !result.wrong && !result.missed && !result.invented && !result.topologyWrong && !result.shapeErrors;
}
module.exports = { score, isPerfect, SCORE_VERSION: 2 };
