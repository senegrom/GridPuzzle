export const TYPES = Object.freeze({
  sudoku: "Sudoku",
  killersudoku: "Killer Sudoku",
  futoshiki: "Futoshiki",
  kenken: "KenKen",
  latinsquare: "Latin square",
  diagonallatinsquare: "Diagonal Latin square",
  pandiagonallatinsquare: "Pandiagonal Latin square",
  hidato: "Hidato",
  numbrix: "Numbrix",
  kakuro: "Kakuro",
  slitherlink: "Slitherlink",
  str8ts: "Str8ts",
});
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const isCage = (type) => ["killersudoku", "kenken"].includes(type);
function dimension(n) {
  if (!Number.isInteger(n) || n < 1 || n > 25)
    throw Error("Board dimensions must be whole numbers from 1 to 25.");
  return n;
}
export function boxShape(n) {
  dimension(n);
  let r = Math.floor(Math.sqrt(n));
  while (n % r) r--;
  return [r, n / r];
}
export function checkDimensions(rows, cols = rows) {
  dimension(rows);
  dimension(cols);
}
export function makePuzzle(type = "sudoku", rows = 9, cols = rows) {
  dimension(rows);
  dimension(cols);
  if (!Object.hasOwn(TYPES, type))
    throw Error("Choose a supported puzzle type.");
  const [boxRows, boxCols] = boxShape(rows);
  return {
    version: 1,
    type,
    rows,
    cols,
    boxRows,
    boxCols,
    cells: Array(rows * cols).fill(null),
    cages: [],
    inequalities: [],
    clues: [],
    black: [],
  };
}
function adjacent(a,b,cols){
  return Math.abs(Math.floor(a/cols)-Math.floor(b/cols))+Math.abs((a%cols)-(b%cols))===1;
}
export function moveIndex(index, key, rows, cols) {
  let r = Math.floor(index / cols),
    c = index % cols;
  if (key === "ArrowLeft") c = Math.max(0, c - 1);
  else if (key === "ArrowRight") c = Math.min(cols - 1, c + 1);
  else if (key === "ArrowUp") r = Math.max(0, r - 1);
  else if (key === "ArrowDown") r = Math.min(rows - 1, r + 1);
  else return index;
  return r * cols + c;
}
export function hasCageRemoval(p, cells) {
  const selected = new Set(cells);
  return (
    selected.size > 0 &&
    Boolean(p?.cages?.some((cage) => cage.cells?.some((i) => selected.has(i))))
  );
}
export function hasInequalityRemoval(p, cells) {
  const selected = new Set(cells);
  return (
    selected.size === 2 &&
    Boolean(
      p?.inequalities?.some(
        (q) => selected.has(q.less) && selected.has(q.greater),
      ),
    )
  );
}
export function checkShape(p) {
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    !Object.hasOwn(TYPES, p.type)
  )
    throw Error("Choose a supported puzzle type.");
  for (const k of ["rows", "cols"])
    if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 25)
      throw Error("Board dimensions must be whole numbers from 1 to 25.");
  if (!Array.isArray(p.cells) || p.cells.length !== p.rows * p.cols)
    throw Error("The number of cells does not match the board dimensions.");
  if (
    !["hidato", "numbrix", "kakuro", "slitherlink"].includes(p.type) &&
    p.rows !== p.cols
  )
    throw Error("This type needs a square grid.");
  const allowed = new Set([
    "version", "type", "rows", "cols", "boxRows", "boxCols",
    "cells", "cages", "inequalities", "clues", "black",
  ]);
  for (const key of Object.keys(p))
    if (!allowed.has(key)) throw Error(`Unsupported puzzle field: ${key}`);
  if (p.version !== undefined && p.version !== 1)
    throw Error("Unsupported puzzle format version.");
  const black = new Set(p.black || []);
  if (!Array.isArray(p.black || []) || black.size !== (p.black || []).length || [...black].some((i) => !Number.isInteger(i) || i < 0 || i >= p.cells.length))
    throw Error("Invalid black-cell metadata.");
  if (p.type !== "str8ts" && black.size)
    throw Error("Black-cell metadata is only supported for Str8ts.");
  if (p.type === "str8ts" && (p.rows !== p.cols || p.rows > 9))
    throw Error("Str8ts requires a square board no larger than 9 × 9.");
  const maximum =
    p.type === "slitherlink"
      ? 4
      : ["hidato", "numbrix"].includes(p.type)
        ? p.cells.filter((v) => v !== "#").length
        : p.type === "kakuro"
          ? 9
          : p.rows;
  p.cells.forEach((v, i) => {
    if (v === null) return;
    if (v === "#" && (["hidato", "kakuro"].includes(p.type) || (p.type === "str8ts" && black.has(i)))) return;
    if (
      !Number.isInteger(v) ||
      v < (p.type === "slitherlink" ? 0 : 1) ||
      v > maximum
    )
      throw Error(`Cell ${i + 1} is outside the allowed range.`);
  });
  if (p.type === "str8ts") {
    for (const i of black) if (p.cells[i] === null) throw Error("A Str8ts black cell must contain # or a numbered clue.");
    p.cells.forEach((v, i) => { if (v === "#" && !black.has(i)) throw Error("Every # Str8ts cell must be listed as black."); });
  }
  for (const key of ["boxRows", "boxCols"])
    if (p[key] !== undefined) dimension(p[key]);
  if (["sudoku", "killersudoku"].includes(p.type)) {
    const br = p.boxRows ?? 3, bc = p.boxCols ?? 3;
    if (br * bc !== p.rows || p.rows % br || p.cols % bc)
      throw Error("Box dimensions must tile the board and contain one of each value.");
  }
  for (const key of ["cages", "inequalities", "clues"]) {
    const limit = (key === "inequalities" ? 2 : 1) * p.cells.length;
    if (p[key] !== undefined && (!Array.isArray(p[key]) || p[key].length > limit))
      throw Error(`Invalid ${key}.`);
  }
  if ((p.cages || []).length && !isCage(p.type))
    throw Error("Cages require Killer Sudoku or KenKen.");
  if ((p.inequalities || []).length && p.type !== "futoshiki")
    throw Error("Inequalities require Futoshiki.");
  if ((p.clues || []).length && p.type !== "kakuro")
    throw Error("Across/down clues require Kakuro.");
  const object = (value, allowedFields, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowedFields.includes(k)))
      throw Error(`Invalid ${name} fields.`);
  };
  const index = (i) => Number.isInteger(i) && i >= 0 && i < p.cells.length;
  const covered = new Set();
  for (const cage of p.cages || []) {
    object(cage, ["cells", "target", "op"], "cage");
    if (!Array.isArray(cage.cells) || !cage.cells.length || cage.cells.length > p.cells.length || cage.cells.some((i) => !index(i)) || new Set(cage.cells).size !== cage.cells.length)
      throw Error("Invalid cage cells.");
    if (cage.cells.some(i=>covered.has(i))) throw Error("Cages may not overlap.");
    cage.cells.forEach(i=>covered.add(i));
    const area=new Set(cage.cells), reached=new Set([cage.cells[0]]), pending=[cage.cells[0]];
    while(pending.length){const at=pending.pop();for(const other of area)if(!reached.has(other)&&adjacent(at,other,p.cols)){reached.add(other);pending.push(other);}}
    if(reached.size!==area.size) throw Error("Cage cells must be orthogonally connected.");
    if (cage.target != null && (!Number.isSafeInteger(cage.target) || cage.target < 1 || cage.target > 1e12))
      throw Error("Invalid cage target.");
    const op=cage.op??"+";
    if (!["+", "-", "*", "/", "="].includes(op)) throw Error("Invalid cage operator.");
    if(p.type==="killersudoku"&&op!=="+") throw Error("Killer Sudoku cages must be sums.");
    if(["-","/"].includes(op)&&cage.cells.length!==2) throw Error("Difference and division cages require exactly two cells.");
    if(op==="="&&cage.cells.length!==1) throw Error("A = cage must contain exactly one cell.");
  }
  for (const q of p.inequalities || []) {
    object(q, ["less", "greater"], "inequality");
    if (!index(q.less) || !index(q.greater) || !adjacent(q.less,q.greater,p.cols))
      throw Error("Inequality cells must share a side.");
  }
  const clueCells = new Set();
  for (const q of p.clues || []) {
    object(q, ["cell", "across", "down"], "Kakuro clue");
    if (!index(q.cell) || p.cells[q.cell] !== "#" || clueCells.has(q.cell))
      throw Error("Each Kakuro clue needs a distinct blocked cell.");
    if(q.across==null&&q.down==null) throw Error("A Kakuro clue needs an across or down target.");
    clueCells.add(q.cell);
    for (const direction of ["across", "down"])
      if (q[direction] != null && (!Number.isInteger(q[direction]) || q[direction] < 1 || q[direction] > 45))
        throw Error("Kakuro targets must be from 1 to 45.");
  }
  return p;
}
export function normalizePuzzle(p) {
  // Validate first: never repair invalid Sudoku rules supplied by an import.
  checkShape(p);
  // Match checkShape's defaults when a valid boxed puzzle supplies only one
  // dimension; changing that shape would change its Sudoku rules.
  let boxRows = p.boxRows ?? 3, boxCols = p.boxCols ?? 3;
  // Box metadata on other families can be absent, or contain the old 3x3
  // defaults from an autosave. Keep valid explicit shapes for a later type
  // change; otherwise use a shape compatible with the board dimensions.
  if (boxRows * boxCols !== p.rows || p.rows % boxRows || p.cols % boxCols)
    [boxRows, boxCols] = boxShape(p.rows);
  return {
    ...clone(p),
    boxRows,
    boxCols,
    cages: clone(p.cages || []),
    inequalities: clone(p.inequalities || []),
    clues: clone(p.clues || []),
    black: clone(p.black || []),
  };
}
// Explicit editor action, not import normalization: preserve clues and reject
// incompatible structures instead of silently dropping them.
export function changePuzzleType(p, type) {
  checkShape(p);
  if (!Object.hasOwn(TYPES, type))
    throw Error("Select an explicit puzzle type.");
  if (
    ((p.cages || []).length && !isCage(type)) ||
    ((p.inequalities || []).length && type !== "futoshiki") ||
    ((p.clues || []).length && type !== "kakuro") ||
    ((p.black || []).length && type !== "str8ts")
  )
    throw Error(
      "This board has structural clues for a different puzzle type. Remove those constraints explicitly or start a blank board; they will not be silently discarded.",
    );
  if (type === "killersudoku" && (p.cages || []).some((c) => c.op && c.op !== "+"))
    throw Error(
      "Killer Sudoku cages must be sums. Correct the operators before changing the type.",
    );
  const next = clone(p);
  if (type === "str8ts" && p.type !== "str8ts")
    // Automatic recognition can propose Hidato for a Str8ts board without
    // numbered black clues. Its # cells already locate the black separators.
    next.black = next.cells.flatMap((value, i) => value === "#" ? [i] : []);
  next.type = type;
  checkShape(next);
  return next;
}
// The editor allows useful incomplete states; Solve needs the structure the
// Python adapter will demand, reported here with a local message before the
// interpreter loads.
export function checkSolveReady(p) {
  checkShape(p);
  if (isCage(p.type)) {
    const covered = new Set();
    for (const cage of p.cages || []) {
      if (cage.target == null)
        throw Error("Every cage needs a target before solving.");
      for (const i of cage.cells) covered.add(i);
    }
    if (covered.size !== p.cells.length)
      throw Error(
        `Cages must cover every cell before solving; ${p.cells.length - covered.size} cells still need a cage.`,
      );
  }
  if (p.type === "kakuro") {
    const white = new Set(
      p.cells.flatMap((value, i) => (value === "#" ? [] : [i])),
    );
    if (!white.size) throw Error("Kakuro needs at least one white cell.");
    const coverage = new Map(
      [...white].map((i) => [i, { across: 0, down: 0 }]),
    );
    for (const clue of p.clues || []) {
      const r = Math.floor(clue.cell / p.cols),
        c = clue.cell % p.cols;
      for (const [direction, dr, dc] of [
        ["across", 0, 1],
        ["down", 1, 0],
      ]) {
        if (clue[direction] == null) continue;
        const run = [];
        for (
          let rr = r + dr, cc = c + dc;
          rr >= 0 &&
          rr < p.rows &&
          cc >= 0 &&
          cc < p.cols &&
          white.has(rr * p.cols + cc);
          rr += dr, cc += dc
        )
          run.push(rr * p.cols + cc);
        if (run.length < 2 || run.length > 9)
          throw Error(
            `Each Kakuro ${direction} clue must start a run of 2 to 9 white cells.`,
          );
        for (const i of run) coverage.get(i)[direction]++;
      }
    }
    const incomplete = [...coverage.values()].filter(
      (count) => count.across !== 1 || count.down !== 1,
    ).length;
    if (incomplete)
      throw Error(
        `Every Kakuro white cell needs exactly one across and one down run; ${incomplete} cells are incomplete.`,
      );
  }
  return p;
}
export function conflicts(p) {
  checkShape(p);
  const bad = new Set();
  const unique = (indices) => {
    const seen = new Map();
    for (const i of indices) {
      const v = p.cells[i];
      if (!Number.isInteger(v)) continue;
      if (seen.has(v)) { bad.add(i); bad.add(seen.get(v)); }
      else seen.set(v, i);
    }
  };
  const all = Array.from({ length: p.cells.length }, (_, i) => i);
  if (["hidato", "numbrix"].includes(p.type)) unique(all);
  else if (!["kakuro", "slitherlink"].includes(p.type)) {
    for (let r = 0; r < p.rows; r++) unique(all.filter((i) => Math.floor(i / p.cols) === r));
    for (let c = 0; c < p.cols; c++) unique(all.filter((i) => i % p.cols === c));
    if (["sudoku", "killersudoku"].includes(p.type)) {
      const br = p.boxRows === undefined ? 3 : p.boxRows, bc = p.boxCols === undefined ? 3 : p.boxCols;
      for (let r = 0; r < p.rows; r += br) for (let c = 0; c < p.cols; c += bc)
        unique(all.filter((i) => Math.floor(i / p.cols) >= r && Math.floor(i / p.cols) < r + br && i % p.cols >= c && i % p.cols < c + bc));
    }
    if (["diagonallatinsquare", "pandiagonallatinsquare"].includes(p.type)) {
      const offsets = p.type === "pandiagonallatinsquare" ? Array.from({ length: p.rows }, (_, i) => i) : [0];
      for (const k of offsets) {
        unique(all.filter((i) => i % p.cols === (Math.floor(i / p.cols) + k) % p.cols));
        unique(all.filter((i) => i % p.cols === (p.cols - 1 - Math.floor(i / p.cols) + k) % p.cols));
      }
    }
  }
  for (const q of p.inequalities || [])
    if (Number.isInteger(p.cells[q.less]) && Number.isInteger(p.cells[q.greater]) && p.cells[q.less] >= p.cells[q.greater]) { bad.add(q.less); bad.add(q.greater); }
  return bad;
}
export function demo(type = "sudoku") {
  if (type === "sudoku") {
    const p = makePuzzle();
    p.cells = [..."530070000600195000098000060800060003400803001700020006060000280000419005000080079"].map((v) => +v || null);
    return p;
  }
  if (type === "str8ts") { const p = makePuzzle(type, 3); p.black = [4]; p.cells = [1,2,3,2,3,1,3,1,null]; return p; }
  if (type === "slitherlink") { const p = makePuzzle(type, 2); p.cells = [2, 2, 2, 2]; return p; }
  if (type === "kakuro") {
    const p = makePuzzle(type, 3); p.cells = ["#", "#", "#", "#", 1, null, "#", null, null];
    p.clues = [{ cell: 1, down: 4 }, { cell: 2, down: 6 }, { cell: 3, across: 3 }, { cell: 6, across: 7 }]; return p;
  }
  if (["hidato", "numbrix"].includes(type)) { const p = makePuzzle(type, 3); p.cells = [1, null, 3, null, 5, null, 7, null, 9]; return p; }
  const n = type === "pandiagonallatinsquare" ? 5 : 4, p = makePuzzle(type, n);
  const solution = type === "pandiagonallatinsquare"
      ? Array.from({ length: 25 }, (_, i) => ((2 * Math.floor(i / 5) + (i % 5)) % 5) + 1)
      : type === "diagonallatinsquare"
        ? [1,2,3,4,3,4,1,2,4,3,2,1,2,1,4,3]
        : [1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1];
  p.cells = solution.map((v, i) => (i % n === 0 ? null : v));
  if (isCage(type)) p.cages = Array.from({ length: n }, (_, r) => ({ cells: Array.from({ length: n }, (_, c) => r*n+c), target:(n*(n+1))/2, op:"+" }));
  if (type === "futoshiki") p.inequalities = [{ less: 0, greater: 1 }];
  return p;
}
export function classify({ rows, cols, values = [], signs = 0, labels = 0, operators = 0, black = 0, blackNumbers = 0, triangles = 0, boxes = false, dots = false }) {
  if (black && blackNumbers >= 2 && rows === cols && rows <= 9) return { type:"str8ts", review:true, reason:"Multiple centered digits on black cells suggest Str8ts. Check every black cell and printed digit." };
  if (black && triangles) return { type:"kakuro", review:true, reason:"Cross-sum layout detected. Check black cells and both clue directions." };
  if (signs) return { type:"futoshiki", review:true, reason:"Inequalities detected. Check the direction of every sign." };
  if (labels > 1) return { type:operators?"kenken":"killersudoku", review:true, reason:"Cages detected. Check every boundary, target and operator." };
  if (rows === cols && boxes && !black)
    return { type:"sudoku", review:true, reason:"Sudoku box pattern detected. Confirm the type once because faint or cropped clues and extra variant rules may not be visible to automatic recognition." };
  if (black || values.some((n) => Number.isInteger(n) && n > Math.max(rows, cols)))
    return { type:black?"hidato":"numbrix", review:true, reason:"Number-path layout: confirm Hidato (diagonals allowed) or Numbrix (orthogonal only)." };
  if (dots && values.some(Number.isInteger) && values.filter(Number.isInteger).every((n) => n <= 4))
    return { type:"slitherlink", review:true, reason:"Loop layout suggested. Check the dimensions and clues, including zeroes." };
  return { type:rows===cols?"sudoku":"numbrix", review:true, reason:"The rules are ambiguous from the grid alone. Choose the correct type before solving." };
}
export function nextReviewCell(indices, after = -1) {
  const ordered = [...indices].sort((a, b) => a - b);
  return ordered.find((i) => i > after) ?? ordered[0] ?? null;
}
