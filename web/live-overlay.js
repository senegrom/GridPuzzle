import { homography, project, validQuad } from "./geometry.js";
import { checkShape, checkSolveReady, conflicts } from "./model.js";

export const SCAN_COLOURS = Object.freeze({
  recognised: "#22c55e", uncertain: "#facc15", unknown: "#ef4444", solution: "#3b82f6",
});

// Colour is not the only cue: unread/unfilled cells use '?', uncertain values
// carry '?', and solver entries are never allowed to replace printed evidence.
export function overlayCells(found, result = null) {
  if (!found?.puzzle) return [];
  const p = found.puzzle;
  checkShape(p);
  const cellUncertain = new Set(found.cellUncertain ?? found.uncertain ?? []);
  const uncertain = new Set([...cellUncertain,
    ...(found.cageUncertain ?? []), ...conflicts(p)]);
  const marked = new Set(found.markedCells ?? []);
  const solution = result?.status === "unique" && result.complete === true
    && result.solutions?.[0]?.cells?.length === p.cells.length ? result.solutions[0].cells : null;
  const black = new Set(p.black ?? []);
  return p.cells.flatMap((value, cell) => {
    if (value === "#") return marked.has(cell) ? [{ cell, value: "?", kind: "unknown" }] : [];
    if (Number.isInteger(value)) return [{ cell, value,
      kind: uncertain.has(cell) ? "uncertain" : "recognised" }];
    if (black.has(cell)) return [];
    // A missed printed clue is not an empty answer slot.
    if (marked.has(cell) || (!Array.isArray(found.markedCells) && cellUncertain.has(cell))) return [{ cell, value: "?", kind: "unknown" }];
    if (Number.isInteger(solution?.[cell])) return [{ cell, value: solution[cell], kind: "solution" }];
    return [{ cell, value: "?", kind: "unknown" }];
  });
}

export function previewAllowed(found) {
  try {
    checkSolveReady(found.puzzle);
    const p = found.puzzle;
    if ((!p.cells.some(Number.isInteger) && !p.cages.length && !p.clues.length && !p.inequalities.length) || conflicts(p).size) return false;
    const marked = new Set(found.markedCells ?? []);
    for (const cell of Array.isArray(found.markedCells) ? [] : found.cellUncertain ?? found.uncertain ?? []) {
      if (found.puzzle.cells[cell] === null) return false;
    }
    for (const cell of marked) if (!Number.isInteger(found.puzzle.cells[cell])) return false;
    return true;
  } catch { return false; }
}

export function drawLiveOverlay(ctx, width, height, corners, found, result = null) {
  if (!validQuad(corners, width, height) || !found?.puzzle) return;
  const { rows, cols } = found.puzzle, m = homography(corners);
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const item of overlayCells(found, result)) {
    const r = Math.floor(item.cell / cols), c = item.cell % cols;
    const a = project(m, (c + .5) / cols, (r + .5) / rows);
    const left = project(m, c / cols, (r + .5) / rows);
    const right = project(m, (c + 1) / cols, (r + .5) / rows);
    const top = project(m, (c + .5) / cols, r / rows);
    const bottom = project(m, (c + .5) / cols, (r + 1) / rows);
    const cw = Math.hypot(right.x - left.x, right.y - left.y), ch = Math.hypot(bottom.x - top.x, bottom.y - top.y);
    const text = String(item.value) + (item.kind === "uncertain" ? "?" : "");
    const size = Math.max(8, Math.min(ch * .54, cw * .83 / Math.max(1, text.length * .62)));
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(right.y - left.y, right.x - left.x));
    // A dark backing makes all four requested colours legible on white paper
    // and on black Str8ts clues, including in the saved PNG.
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = "#101820df"; ctx.fillRect(-cw * .43, -ch * .34, cw * .86, ch * .68);
    ctx.fillStyle = SCAN_COLOURS[item.kind]; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  for (const [o, r, c] of result?.status === "unique" && result.complete ? result.solutions?.[0]?.edges ?? [] : []) {
    const a = project(m, c / cols, r / rows), b = project(m, (c + (o === "H" ? 1 : 0)) / cols, (r + (o === "V" ? 1 : 0)) / rows);
    ctx.strokeStyle = SCAN_COLOURS.solution; ctx.lineWidth = Math.max(3, width / cols * .06);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

// Compare local blocks as well as the whole frame. A changed clue or a finger
// over one area must not inherit an otherwise identical grid's blue entries.
export function sameFrame(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return false;
  let total = 0;
  for (let i = 0; i < a.length; i += 64) {
    let local = 0;
    for (let j = i; j < Math.min(a.length, i + 64); j++) local += Math.abs(a[j] - b[j]);
    if (local / Math.min(64, a.length - i) > 16) return false;
    total += local;
  }
  return total / a.length < 6;
}
