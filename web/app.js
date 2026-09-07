import { nextReviewCell } from "./model.js";
import { createTaskController } from "./task-controller.js";
import { captureEdit, restoreEdit, rememberEdit } from "./edit-history.js";
import { setupPhotoFlow } from "./photo-flow.js";
import { setupOffline } from "./offline.js";
import {
  TYPES,
  makePuzzle,
  demo,
  clone,
  checkShape,
  conflicts,
  isCage,
  boxShape,
  moveIndex,
  hasCageRemoval,
  hasInequalityRemoval,
  checkSolveReady,
} from "./model.js";
import { Scanner } from "./scanner.js";
import { homography, project } from "./geometry.js";
import { saveSession, restoreSession } from "./session.js";

const $ = (id) => document.getElementById(id),
  NS = "http://www.w3.org/2000/svg",
  scanner = new Scanner();
const state = {
  puzzle: makePuzzle(),
  uncertain: new Set(),
  needsReview: false,
  notes: [],
  result: null,
  solution: 0,
  photo: null,
  rectified: null,
  puzzleSource: null,
  photoSource: null,
  corners: null,
  photoRows: 0,
  photoCols: 0,
  view: "board",
  selected: [],
  history: [],
};
let worker = null,
  editing = 0,
  focused = 0;
const storage = {
  get: (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Private/storage-full mode must not break solving. */
    }
  },
};
for (const [value, label] of Object.entries(TYPES)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  $("puzzle-type").append(option);
}
const applyType = document.createElement("button");
applyType.id = "use-type";
applyType.className = "text-button";
applyType.hidden = true;
$("type-help").after(applyType);
// Version 1 preferences could hold a puzzle type written by board loading
// rather than chosen by the user, so only the explicit settings migrate and
// the scan type starts over at automatic detection.
const legacyPrefs = storage.get("gridpuzzle-settings-v1"),
  prefs =
    storage.get("gridpuzzle-settings-v2") ||
    (legacyPrefs && typeof legacyPrefs === "object"
      ? { ...legacyPrefs, type: "auto" }
      : null);
if (prefs) {
  if (prefs.type === "auto" || Object.hasOwn(TYPES, prefs.type))
    $("puzzle-type").value = prefs.type;
  for (const id of ["auto-capture", "auto-solve"])
    if (typeof prefs[id] === "boolean") $(id).checked = prefs[id];
  if (["0", "30", "90", "300"].includes(prefs.limit))
    $("time-limit").value = prefs.limit;
}
function savePrefs() {
  storage.set("gridpuzzle-settings-v2", {
    type: $("puzzle-type").value,
    "auto-capture": $("auto-capture").checked,
    "auto-solve": $("auto-solve").checked,
    limit: $("time-limit").value,
  });
}
for (const id of ["puzzle-type", "auto-capture", "auto-solve", "time-limit"])
  $(id).addEventListener("change", savePrefs);
function typeControl() {
  const type = $("puzzle-type").value;
  applyType.hidden = type === "auto" || type === state.puzzle.type;
  applyType.textContent = `Use ${TYPES[type] || "this type"} for the current board`;
}
$("puzzle-type").addEventListener("change", typeControl);
function status(text, detail = "", kind = "info", progress = null) {
  delete $("status").dataset.result;
  $("status").className = `status ${kind}`;
  $("status-text").textContent = text;
  $("status-detail").textContent = detail;
  $("progress").hidden = !tasks.busy;
  if (progress === null) $("progress").removeAttribute("value");
  else $("progress").value = progress;
}
function fail(error) {
  if (error?.name !== "AbortError")
    status(
      error?.message || String(error),
      "Nothing was uploaded or sent to a remote solver.",
      "error",
    );
}
function remember() {
  rememberEdit(state);
}

function persist() {
  saveSession(storage, state);
}
const tasks = createTaskController({
  $,
  scanner,
  status,
  onStop: (wasBusy) => {
    if (wasBusy && worker) {
      worker.terminate();
      worker = null;
    }
  },
});
const stopTask = (message) => tasks.stop(message);
const begin = () => tasks.begin();
const finish = () => tasks.finish();
function invalidate() {
  stopTask();
  state.result = null;
  state.solution = 0;
  state.view = "board";
  status(
    "Puzzle changed.",
    "Solve again to check the updated clues and rules.",
  );
}
function mutate(fn) {
  const previous = captureEdit(state),
    history = [...state.history];
  remember();
  invalidate();
  try {
    fn();
    checkShape(state.puzzle);
  } catch (error) {
    restoreEdit(state, previous);
    state.history = history;
    render();
    throw error;
  }
  persist();
  render();
}
function normalized(p) {
  checkShape(p);
  return {
    ...clone(p),
    boxRows: p.boxRows === undefined ? 3 : p.boxRows,
    boxCols: p.boxCols === undefined ? 3 : p.boxCols,
    cages: clone(p.cages || []),
    inequalities: clone(p.inequalities || []),
    clues: clone(p.clues || []),
  };
}
export function loadPuzzle(payload) {
  const p = normalized(payload);
  remember();
  invalidate();
  stopCamera();
  state.puzzle = p;
  state.uncertain.clear();
  state.needsReview = false;
  state.notes = [];
  state.photo =
    state.rectified =
    state.puzzleSource =
    state.photoSource =
    state.corners =
      null;
  $("photo-panel").hidden = true;
  state.selected = [];
  focused = 0;
  persist();
  render();
  status(
    "Puzzle loaded.",
    `${TYPES[p.type]} · Tap any cell to edit its printed clue.`,
  );
}
export function getState() {
  return {
    puzzle: clone(state.puzzle),
    result: clone(state.result),
    uncertain: [...state.uncertain],
    needsReview: state.needsReview,
    busy: tasks.busy,
  };
}
function svg(tag, attrs = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs))
    if (k === "style")
      // CSSOM writes are allowed under the strict style-src policy; a style
      // attribute set through setAttribute is not.
      for (const declaration of String(v).split(";")) {
        const at = declaration.indexOf(":");
        if (at > 0)
          node.style.setProperty(
            declaration.slice(0, at).trim(),
            declaration.slice(at + 1).trim(),
          );
      }
    else node.setAttribute(k, String(v));
  if (text !== null) node.textContent = String(text);
  return node;
}
function drawBoard() {
  const p = state.puzzle,
    board = $("board"),
    size = 72,
    margin = 5,
    sol = state.result?.solutions?.[state.solution],
    bad = conflicts(p);
  focused = Math.min(focused, p.cells.length - 1);
  board.style.minWidth = `${Math.max(240, p.cols * 34)}px`;
  board.replaceChildren();
  board.setAttribute(
    "viewBox",
    `-${margin} -${margin} ${p.cols * size + 2 * margin} ${p.rows * size + 2 * margin}`,
  );
  const cages = new Map();
  p.cages.forEach((c, k) => c.cells.forEach((i) => cages.set(i, k)));
  for (let i = 0; i < p.cells.length; i++) {
    const r = Math.floor(i / p.cols),
      c = i % p.cols,
      x = c * size,
      y = r * size,
      given = p.cells[i],
      value = sol?.cells[i] ?? given;
    const classes = ["board-cell"];
    if (given === "#") classes.push("blocked");
    else if (given === null && Number.isInteger(value)) classes.push("answer");
    if (state.uncertain.has(i)) classes.push("uncertain");
    if (bad.has(i)) classes.push("conflict");
    if (state.selected.includes(i)) classes.push("selected");
    const g = svg("g", {
      class: classes.join(" "),
      "data-cell": i,
      role: "button",
      tabindex: i === focused ? 0 : -1,
      "aria-label": `Row ${r + 1}, column ${c + 1}: ${given === null ? "blank" : given === "#" ? "blocked" : given}${state.uncertain.has(i) ? ", check reading" : ""}`,
    });
    g.append(
      svg("rect", { x, y, width: size, height: size, class: "cell-hit" }),
    );
    if (given === "#" && p.type === "kakuro") {
      const clue = p.clues.find((q) => q.cell === i);
      if (clue) {
        g.append(svg("path", { d: `M${x},${y}l72,72`, stroke: "#829b91" }));
        if (clue.across != null)
          g.append(
            svg(
              "text",
              { x: x + 51, y: y + 24, class: "kakuro-clue" },
              clue.across,
            ),
          );
        if (clue.down != null)
          g.append(
            svg(
              "text",
              { x: x + 21, y: y + 59, class: "kakuro-clue" },
              clue.down,
            ),
          );
      }
    } else if (Number.isInteger(value))
      g.append(
        svg(
          "text",
          {
            x: x + 36,
            y: y + 47,
            style: `font-size:${value >= 100 ? 22 : 30}px`,
          },
          value,
        ),
      );
    board.append(g);
  }
  if (
    ["sudoku", "killersudoku"].includes(p.type) &&
    Number.isInteger(p.boxRows) &&
    Number.isInteger(p.boxCols) &&
    p.boxRows > 0 &&
    p.boxCols > 0
  ) {
    for (let r = 0; r <= p.rows; r += p.boxRows)
      board.append(
        svg("path", {
          d: `M0 ${r * size}H${p.cols * size}`,
          class: "box-line",
        }),
      );
    for (let c = 0; c <= p.cols; c += p.boxCols)
      board.append(
        svg("path", {
          d: `M${c * size} 0V${p.rows * size}`,
          class: "box-line",
        }),
      );
  }
  if (isCage(p.type))
    p.cages.forEach((cage, k) => {
      for (const i of cage.cells) {
        const r = Math.floor(i / p.cols),
          c = i % p.cols,
          x = c * size,
          y = r * size;
        let d = "";
        if (r === 0 || cages.get(i - p.cols) !== k)
          d += `M${x + 4} ${y + 4}h64`;
        if (c === p.cols - 1 || cages.get(i + 1) !== k)
          d += `M${x + 68} ${y + 4}v64`;
        if (r === p.rows - 1 || cages.get(i + p.cols) !== k)
          d += `M${x + 4} ${y + 68}h64`;
        if (c === 0 || cages.get(i - 1) !== k) d += `M${x + 4} ${y + 4}v64`;
        board.append(
          svg("path", {
            d,
            class: "cage-line",
            "stroke-dasharray": p.type === "killersudoku" ? "3 3" : "none",
          }),
        );
      }
      const i = Math.min(...cage.cells),
        text = `${cage.target ?? "?"}${p.type === "kenken" ? { "*": "×", "/": "÷" }[cage.op] || cage.op || "+" : ""}`;
      board.append(
        svg(
          "text",
          {
            x: (i % p.cols) * size + 8,
            y: Math.floor(i / p.cols) * size + 17,
            "font-size": 13,
            fill: "#45665e",
            "pointer-events": "none",
          },
          text,
        ),
      );
    });
  for (const q of p.inequalities) {
    const ar = Math.floor(q.less / p.cols),
      ac = q.less % p.cols,
      br = Math.floor(q.greater / p.cols),
      bc = q.greater % p.cols,
      x = ((ac + bc + 1) * size) / 2,
      y = ((ar + br + 1) * size) / 2;
    board.append(
      svg("rect", {
        x: x - 10,
        y: y - 13,
        width: 20,
        height: 26,
        fill: "#fff",
        "pointer-events": "none",
      }),
    );
    board.append(
      svg(
        "text",
        { x, y: y + 8, class: "inequality" },
        ar === br ? (ac < bc ? "<" : ">") : ar < br ? "⌃" : "⌄",
      ),
    );
  }
  if (p.type === "slitherlink") {
    for (const [orientation, r, c] of sol?.edges || [])
      board.append(
        svg("line", {
          x1: c * size,
          y1: r * size,
          x2: (c + (orientation === "H" ? 1 : 0)) * size,
          y2: (r + (orientation === "V" ? 1 : 0)) * size,
          class: "loop-edge",
        }),
      );
    for (let r = 0; r <= p.rows; r++)
      for (let c = 0; c <= p.cols; c++)
        board.append(
          svg("circle", {
            cx: c * size,
            cy: r * size,
            r: 3,
            fill: "#173536",
            "pointer-events": "none",
          }),
        );
  }
}
function canOverlay() {
  return !!(
    state.photo &&
    state.corners &&
    state.rectified &&
    state.puzzleSource === state.photoSource &&
    state.result?.solutions?.length &&
    state.photoRows === state.puzzle.rows &&
    state.photoCols === state.puzzle.cols
  );
}
function clearPhotoMapping() {
  state.rectified = null;
  state.photoSource = null;
  state.photoRows = state.photoCols = 0;
  state.view = "board";
  $("photo-view").disabled = true;
  $("save-photo").hidden = true;
  $("solution-photo").hidden = true;
  $("board-scroll").hidden = false;
  $("clean-view").setAttribute("aria-pressed", "true");
  $("photo-view").setAttribute("aria-pressed", "false");
}
function drawOverlay() {
  if (!canOverlay()) return;
  const out = $("solution-photo"),
    ctx = out.getContext("2d"),
    p = state.puzzle,
    sol = state.result.solutions[state.solution];
  out.width = state.photo.width;
  out.height = state.photo.height;
  ctx.drawImage(state.photo, 0, 0);
  const m = homography(state.corners),
    point = (r, c) => project(m, c / p.cols, r / p.rows);
  ctx.strokeStyle = "#078772";
  ctx.lineWidth = Math.max(3, out.width / 180);
  ctx.lineCap = "round";
  if (p.type === "slitherlink")
    for (const [o, r, c] of sol.edges) {
      const a = point(r, c),
        b = point(r + (o === "V" ? 1 : 0), c + (o === "H" ? 1 : 0));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  else
    for (let i = 0; i < p.cells.length; i++)
      if (p.cells[i] === null && Number.isInteger(sol.cells[i])) {
        const r = Math.floor(i / p.cols),
          c = i % p.cols,
          a = point(r + 0.5, c + 0.5),
          b = point(r + 0.5, c + 1.1),
          height = point(r + 1, c + 0.5),
          font = Math.max(
            10,
            Math.min(
              Math.hypot(a.x - b.x, a.y - b.y),
              Math.hypot(a.x - height.x, a.y - height.y),
            ) * 1.05,
          );
        ctx.font = `650 ${font}px -apple-system,Arial,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, font * 0.1);
        ctx.strokeStyle = "#ffffffee";
        ctx.strokeText(String(sol.cells[i]), a.x, a.y);
        ctx.fillStyle = "#067c6b";
        ctx.fillText(String(sol.cells[i]), a.x, a.y);
      }
}
function render() {
  const p = state.puzzle;
  $("board-meta").textContent =
    `${TYPES[p.type]} · ${p.rows} × ${p.cols} · ${p.cells.filter(Number.isInteger).length} printed clues`;
  $("rows").value = p.rows;
  $("cols").value = p.cols;
  $("box-rows").value = p.boxRows || boxDefault(p.rows)[0];
  $("box-cols").value = p.boxCols || boxDefault(p.rows)[1];
  $("box-fields").hidden = !["sudoku", "killersudoku"].includes(p.type);
  $("undo").disabled = !state.history.length;
  typeControl();
  for (const option of $("edit-tool").options)
    option.disabled =
      (option.value === "cage" && !isCage(p.type)) ||
      (option.value === "inequality" && p.type !== "futoshiki");
  if ($("edit-tool").selectedOptions[0]?.disabled)
    $("edit-tool").value = "value";
  $("cage-editor").hidden = $("edit-tool").value !== "cage";
  $("inequality-editor").hidden = $("edit-tool").value !== "inequality";
  $("cage-op").disabled = p.type === "killersudoku";
  $("json-data").value = JSON.stringify(p, null, 2);
  drawBoard();
  const overlay = canOverlay();
  $("photo-view").disabled = !overlay;
  $("save-photo").hidden = !overlay;
  $("show-crop").hidden = !state.photo;
  if (!overlay) state.view = "board";
  $("board-scroll").hidden = state.view === "photo";
  $("solution-photo").hidden = state.view !== "photo";
  $("clean-view").setAttribute("aria-pressed", String(state.view === "board"));
  $("photo-view").setAttribute("aria-pressed", String(state.view === "photo"));
  if (overlay) drawOverlay();
  $("next-solution").hidden = (state.result?.solutions?.length || 0) < 2;
  const review = state.uncertain.size || state.needsReview;
  $("review-note").hidden = !review;
  $("review-clues").hidden = !state.uncertain.size;
  $("review-clues").textContent =
    `Review ${state.uncertain.size} highlighted clues`;
  const sourceAvailable =
    state.rectified && state.puzzleSource === state.photoSource;
  const checkMessage = state.uncertain.size
    ? `${state.uncertain.size} cells need checking. ${sourceAvailable ? "Tap a highlighted cell to compare it with the photograph." : "Check the highlighted clues against the original puzzle. Photos are not retained after closing the app."}`
    : "Confirm the puzzle type and structural clues.";
  $("review-note").textContent = [checkMessage, ...state.notes].join("\n");
  $("solve").textContent = review ? "Check & solve →" : "Solve puzzle →";
}
const boxDefault = boxShape;
applyType.onclick = () => {
  try {
    const next = clone(state.puzzle),
      type = $("puzzle-type").value;
    if (!Object.hasOwn(TYPES, type))
      throw Error("Select an explicit puzzle type.");
    if (
      (next.cages.length && !isCage(type)) ||
      (next.inequalities.length && type !== "futoshiki") ||
      (next.clues.length && type !== "kakuro")
    )
      throw Error(
        "This board has structural clues for a different puzzle type. Remove those constraints explicitly or start a blank board; they will not be silently discarded.",
      );
    if (type === "killersudoku" && next.cages.some((c) => c.op && c.op !== "+"))
      throw Error(
        "Killer Sudoku cages must be sums. Correct the operators before changing the type.",
      );
    next.type = type;
    checkShape(next);
    mutate(() => {
      state.puzzle = next;
      state.needsReview = Boolean(state.photo);
      state.notes = [
        `Rules changed to ${TYPES[type]}. Printed clues have been kept.`,
      ];
      state.selected = [];
    });
    status(
      `Using ${TYPES[type]}.`,
      "Printed values are unchanged. Check the rules before solving.",
    );
  } catch (error) {
    fail(error);
  }
};
function openCell(i) {
  stopTask(tasks.busy ? "Stopped for editing." : null);
  editing = i;
  focused = i;
  const p = state.puzzle,
    r = Math.floor(i / p.cols),
    c = i % p.cols;
  $("cell-title").textContent = `Row ${r + 1} · Column ${c + 1}`;
  $("cell-value").value = Number.isInteger(p.cells[i]) ? p.cells[i] : "";
  $("blocked-cell").checked = p.cells[i] === "#";
  $("block-option").hidden = !["hidato", "kakuro"].includes(p.type);
  $("cell-error").textContent = "";
  const clue = p.clues.find((q) => q.cell === i);
  $("across-value").value = clue?.across ?? "";
  $("down-value").value = clue?.down ?? "";
  blockInputs();
  $("clue-crop").hidden = !(
    state.rectified &&
    state.puzzleSource === state.photoSource &&
    state.photoRows === p.rows &&
    state.photoCols === p.cols
  );
  if (!$("clue-crop").hidden) {
    const out = $("clue-crop"),
      ctx = out.getContext("2d"),
      cw = state.rectified.width / p.cols,
      ch = state.rectified.height / p.rows;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 180, 180);
    ctx.drawImage(state.rectified, c * cw, r * ch, cw, ch, 0, 0, 180, 180);
  }
  $("save-next").hidden = !state.uncertain.size;
  $("review-position").hidden = !state.uncertain.size;
  $("review-position").textContent =
    `${state.uncertain.size} readings left to check. Saving confirms only this cell.`;
  $("cell-dialog").showModal();
  $("cell-value").focus();
  $("cell-value").select();
}
function blockInputs() {
  $("cell-value").disabled = $("blocked-cell").checked;
  $("kakuro-inputs").hidden =
    state.puzzle.type !== "kakuro" || !$("blocked-cell").checked;
}
$("blocked-cell").onchange = blockInputs;
function numberInput(id) {
  const text = $(id).value.trim();
  if (!text) return null;
  if (!/^\d{1,12}$/.test(text))
    throw Error("Use a whole number, or leave the field blank.");
  return Number(text);
}
function saveCell(advance = false) {
  try {
    const next = clone(state.puzzle),
      blocked = !$("block-option").hidden && $("blocked-cell").checked;
    next.cells[editing] = blocked ? "#" : numberInput("cell-value");
    next.clues = next.clues.filter((q) => q.cell !== editing);
    if (blocked && next.type === "kakuro") {
      const across = numberInput("across-value"),
        down = numberInput("down-value");
      if (
        (across !== null && (across < 1 || across > 45)) ||
        (down !== null && (down < 1 || down > 45))
      )
        throw Error("Kakuro targets must be from 1 to 45.");
      if (across !== null || down !== null)
        next.clues.push({ cell: editing, across, down });
    }
    checkShape(next);
    mutate(() => {
      state.puzzle = next;
      state.uncertain.delete(editing);
    });
    $("cell-dialog").close();
    status("Clue saved.", "The previous solution has been cleared.");
    if (advance) {
      const next = nextReviewCell(state.uncertain, editing);
      if (next !== null) openCell(next);
      else
        status(
          "Highlighted readings checked.",
          "Confirm the puzzle type and any structural clues, then solve.",
        );
    }
  } catch (e) {
    $("cell-error").textContent = e.message;
  }
}
$("review-clues").onclick = () => {
  const cell = nextReviewCell(state.uncertain);
  if (cell !== null) openCell(cell);
};
$("save-next").onclick = () => saveCell(true);
$("cell-form").onsubmit = (e) => {
  e.preventDefault();
  saveCell();
};
$("clear-cell").onclick = () => {
  $("cell-value").value = "";
  $("blocked-cell").checked = false;
  $("across-value").value = $("down-value").value = "";
  saveCell();
};
$("close-cell").onclick = () => $("cell-dialog").close();
function cellAction(i) {
  const tool = $("edit-tool").value;
  if (tool === "value") return openCell(i);
  stopTask();
  if (state.selected.includes(i))
    state.selected = state.selected.filter((x) => x !== i);
  else {
    if (tool === "inequality" && state.selected.length === 2)
      state.selected = [];
    state.selected.push(i);
  }
  drawBoard();
  status(
    `${state.selected.length} cells selected.`,
    tool === "cage"
      ? "Enter the target and save the cage."
      : "Select the smaller cell first, then the larger adjacent cell.",
  );
}
$("board").onclick = (e) => {
  const cell = e.target.closest("[data-cell]");
  if (cell) cellAction(Number(cell.dataset.cell));
};
$("board").onkeydown = (e) => {
  const cell = e.target.closest("[data-cell]");
  if (!cell) return;
  const i = Number(cell.dataset.cell);
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    cellAction(i);
    return;
  }
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    const next = moveIndex(i, e.key, state.puzzle.rows, state.puzzle.cols);
    if (next === i) return;
    focused = next;
    drawBoard();
    $("board").querySelector(`[data-cell="${focused}"]`)?.focus();
  }
};
$("edit-tool").onchange = () => {
  state.selected = [];
  render();
};
$("clear-selection").onclick = () => {
  state.selected = [];
  drawBoard();
};
$("save-cage").onclick = () => {
  try {
    const target = numberInput("cage-target");
    if (!target || !state.selected.length)
      throw Error("Select cage cells and enter a positive target.");
    const cells = [...state.selected],
      op = state.puzzle.type === "killersudoku" ? "+" : $("cage-op").value;
    mutate(() => {
      state.puzzle.cages = state.puzzle.cages.filter(
        (q) => !q.cells.some((i) => cells.includes(i)),
      );
      state.puzzle.cages.push({
        cells: cells.sort((a, b) => a - b),
        target,
        op,
      });
      cells.forEach((i) => state.uncertain.delete(i));
      state.selected = [];
    });
    status(
      "Cage saved.",
      "Every cell must belong to exactly one cage before solving.",
    );
  } catch (e) {
    fail(e);
  }
};
$("remove-cage").onclick = () => {
  if (!hasCageRemoval(state.puzzle, state.selected)) return;
  mutate(() => {
    state.puzzle.cages = state.puzzle.cages.filter(
      (q) => !q.cells.some((i) => state.selected.includes(i)),
    );
    state.selected = [];
  });
};
$("save-inequality").onclick = () => {
  try {
    if (state.selected.length !== 2)
      throw Error("Select the smaller cell and its larger neighbour.");
    const [less, greater] = state.selected,
      p = state.puzzle;
    if (
      Math.abs(Math.floor(less / p.cols) - Math.floor(greater / p.cols)) +
        Math.abs((less % p.cols) - (greater % p.cols)) !==
      1
    )
      throw Error("Inequality cells must share a side.");
    mutate(() => {
      p.inequalities = p.inequalities.filter(
        (q) =>
          ![less, greater].includes(q.less) ||
          ![less, greater].includes(q.greater),
      );
      p.inequalities.push({ less, greater });
      state.selected = [];
    });
  } catch (e) {
    fail(e);
  }
};
$("remove-inequality").onclick = () => {
  if (!hasInequalityRemoval(state.puzzle, state.selected)) return;
  mutate(() => {
    state.puzzle.inequalities = state.puzzle.inequalities.filter(
      (q) =>
        !(
          state.selected.includes(q.less) && state.selected.includes(q.greater)
        ),
    );
    state.selected = [];
  });
};
$("undo").onclick = () => {
  const previous = state.history.pop();
  if (!previous) return;
  invalidate();
  state.puzzle = previous.puzzle;
  state.puzzleSource = previous.source;
  state.uncertain = new Set(previous.uncertain);
  state.needsReview = previous.needsReview;
  state.notes = previous.notes;
  state.selected = [];
  persist();
  render();
  status("Last edit undone.");
};
$("stop").onclick = () => stopTask("Stopped.");
function requestSolve() {
  try {
    checkSolveReady(state.puzzle);
    if (state.uncertain.size || state.needsReview) {
      $("confirm-text").textContent =
        `${TYPES[state.puzzle.type]} · ${state.puzzle.rows} × ${state.puzzle.cols}. ${state.uncertain.size} cells were highlighted for review.`;
      $("confirm-dialog").showModal();
    } else solveNow();
  } catch (e) {
    fail(e);
  }
}
function solveNow() {
  try {
    checkSolveReady(state.puzzle);
  } catch (e) {
    fail(e);
    return;
  }
  state.uncertain.clear();
  state.needsReview = false;
  state.notes = [];
  state.result = null;
  state.solution = 0;
  state.view = "board";
  persist();
  render();
  const id = begin();
  if (!worker)
    worker = new Worker(new URL("./solver-worker.js", import.meta.url), {
      type: "module",
    });
  tasks.setDeadline(() => {
    if (id === tasks.id)
      stopTask("Runtime loading timed out. Go online and retry.");
  }, 180000);
  worker.onmessage = ({ data: m }) => {
    if (m.id !== tasks.id) return;
    if (m.type === "status") {
      status(m.message, "Stop cancels this task.");
      if (m.message.startsWith("Solving")) {
        tasks.clearDeadline();
        const seconds = Number($("time-limit").value);
        if (seconds > 0)
          tasks.setDeadline(() => {
            if (id === tasks.id)
              stopTask(
                "Search limit reached. Increase the limit to continue from a fresh search.",
              );
          }, seconds * 1000);
      }
      return;
    }
    finish();
    state.result = m.result;
    render();
    const r = m.result;
    if (r.status === "unique")
      status(
        "Solved · unique solution",
        `Completed and validated in ${r.elapsed.toFixed(2)} seconds. Original clues are preserved.`,
      );
    else if (r.status === "multiple")
      status(
        "More than one solution",
        `At least two valid solutions exist. Check for a missed clue or an incorrect puzzle type. Use “Other solution” to compare.`,
        "warning",
      );
    else if (r.status === "no-solution")
      status(
        "No solution to these clues.",
        "Check the transcription, puzzle type and structural clues. This does not prove the photograph is wrong.",
        "warning",
      );
    else
      status(
        r.status === "invalid"
          ? "Check the puzzle data."
          : "The solver could not finish.",
        r.message || "Please retry.",
        "error",
      );
    $("status").dataset.result = r.status;
  };
  worker.onerror = (e) => {
    if (id !== tasks.id) return;
    worker.terminate();
    worker = null;
    finish();
    status(
      "The solver stopped unexpectedly.",
      e.message ||
        "The phone may have run out of memory. Retry with other tabs closed.",
      "error",
    );
  };
  status("Starting the on-device solver…", "The first load downloads Python.");
  worker.postMessage({ id, puzzle: clone(state.puzzle) });
}
$("solve").onclick = requestSolve;
$("confirm-solve").onclick = () => {
  $("confirm-dialog").close();
  solveNow();
};
$("confirm-back").onclick = () => $("confirm-dialog").close();
$("next-solution").onclick = () => {
  if (state.result?.solutions?.length) {
    state.solution = (state.solution + 1) % state.result.solutions.length;
    render();
  }
};
$("clean-view").onclick = () => {
  state.view = "board";
  render();
};
$("photo-view").onclick = () => {
  state.view = "photo";
  render();
};
$("example").onclick = () => {
  try {
    loadPuzzle(
      demo(
        $("puzzle-type").value === "auto" ? "sudoku" : $("puzzle-type").value,
      ),
    );
  } catch (e) {
    fail(e);
  }
};
$("new-board").onclick = () => {
  try {
    const type =
        $("puzzle-type").value === "auto" ? "sudoku" : $("puzzle-type").value,
      n = ["sudoku", "killersudoku"].includes(type)
        ? 9
        : type === "kenken"
          ? 6
          : 5;
    loadPuzzle(makePuzzle(type, n));
  } catch (e) {
    fail(e);
  }
};
$("apply-layout").onclick = () => {
  try {
    const rows = Number($("rows").value),
      cols = Number($("cols").value),
      type =
        $("puzzle-type").value === "auto"
          ? state.puzzle.type
          : $("puzzle-type").value;
    const next = makePuzzle(type, rows, cols);
    next.boxRows = Number($("box-rows").value);
    next.boxCols = Number($("box-cols").value);
    checkShape(next);
    if (
      type === state.puzzle.type &&
      rows === state.puzzle.rows &&
      cols === state.puzzle.cols
    ) {
      mutate(() => {
        state.puzzle.boxRows = next.boxRows;
        state.puzzle.boxCols = next.boxCols;
      });
    } else if (
      confirm(
        "Changing the board type or dimensions here clears existing clues. To keep clues while changing only the rules, use the button below the puzzle-type selector. Clear this board?",
      )
    )
      loadPuzzle(next);
  } catch (e) {
    fail(e);
  }
};
function download(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$("export-json").onclick = () =>
  download(
    new Blob([JSON.stringify(state.puzzle, null, 2)], {
      type: "application/json",
    }),
    `gridpuzzle-${state.puzzle.type}.json`,
  );
$("save-photo").onclick = () => {
  if (!canOverlay()) {
    status("Read the adjusted crop before exporting an overlay.");
    return;
  }
  drawOverlay();
  $("solution-photo").toBlob((blob) => {
    if (blob) download(blob, "gridpuzzle-solution.png");
  });
};
$("import-json").onclick = () => $("json-file").click();
$("json-file").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 200000)
      throw Error("Puzzle files must be smaller than 200 KB.");
    stopTask();
    const id = tasks.id;
    const parsed = JSON.parse(await file.text());
    if (id === tasks.id) loadPuzzle(parsed);
  } catch (error) {
    fail(error);
  } finally {
    e.target.value = "";
  }
};
$("apply-json").onclick = () => {
  try {
    if ($("json-data").value.length > 200000)
      throw Error("Puzzle data is too large.");
    loadPuzzle(JSON.parse($("json-data").value));
  } catch (e) {
    fail(e);
  }
};

const { stopCamera } = setupPhotoFlow({
  $,
  state,
  scanner,
  stopTask,
  invalidate,
  begin,
  finish,
  fail,
  render,
  status,
  remember,
  persist,
  drawBoard,
  clearPhotoMapping,
  solveNow,
  boxDefault,
  getJobId: () => tasks.id,
  setDeadline: (callback, ms) => tasks.setDeadline(callback, ms),
});
window.addEventListener("pagehide", () => {
  stopCamera();
  stopTask();
  if (worker) {
    worker.terminate();
    worker = null;
  }
});

setupOffline($);
try {
  const saved = restoreSession(storage);
  if (saved) {
    state.puzzle = normalized(saved.puzzle);
    state.uncertain = new Set(saved.uncertain);
    state.needsReview = saved.needsReview;
    state.notes = saved.notes;
  }
} catch {
  /* Ignore malformed/old autosaves. */
}
render();
$("build-label").textContent = "Browser scanner · __BUILD_ID__";
document.body.dataset.ready = "true";
