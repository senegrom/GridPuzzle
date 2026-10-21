import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhotoFlow } from '../photo-flow.js';
import { boxShape, conflicts, fitPlay, makePuzzle } from '../model.js';
import { rememberEdit, restoreEdit } from '../edit-history.js';

// The box controls describe the printed puzzle, upright, whatever frame the
// crop is in. Here a photograph is modelled geometrically, keyed to no quad:
// every canvas carries the printed grid's corners [top-left, top-right,
// bottom-right, bottom-left] in its own pixels, and Rotate's canvas transform
// moves them. The detector returns them in the image's frame, as findGrid
// does, and the reader turns like an ideal Scanner.orient: by the place of the
// printed top-left corner in the quad it is given. The box layout never
// reaches the reader.
//
// The page is a 6 × 6 Sudoku printed with boxes of 2 rows × 3 columns. Its
// ten givens have one solution under those boxes, and under 3 × 2 boxes no
// duplicate and exactly one other solution: read with the boxes transposed,
// it solves without a flag to a wrong unique answer.
const GIVENS = [
  null, null, null, null, 1, null, null, null, 5, null, 3, null, 6, null, null, null, null, 2,
  2, null, null, null, null, null, null, null, null, null, null, 1, 3, null, 4, 6, null, null];
const PRINTED = [
  4, 3, 2, 5, 1, 6, 1, 6, 5, 2, 3, 4, 6, 4, 3, 1, 5, 2,
  2, 5, 1, 4, 6, 3, 5, 2, 6, 3, 4, 1, 3, 1, 4, 6, 2, 5];
const tick = () => new Promise(resolve => setImmediate(resolve));

// Every solution, up to `limit`, of the givens under the given boxes.
function solutions(cells, boxRows, boxCols, limit = 2) {
  const n = 6, grid = cells.map(v => v ?? 0), found = [];
  const box = (r, c) => Math.floor(r / boxRows) * (n / boxCols) + Math.floor(c / boxCols);
  const fits = (i, v) => grid.every((w, j) => w !== v || (Math.floor(i / n) !== Math.floor(j / n) &&
    i % n !== j % n && box(Math.floor(i / n), i % n) !== box(Math.floor(j / n), j % n)));
  (function fill() {
    const i = grid.indexOf(0);
    if (i < 0) { found.push([...grid]); return; }
    for (let v = 1; v <= n && found.length < limit; v++) if (fits(i, v)) { grid[i] = v; fill(); grid[i] = 0; }
  })();
  return found;
}
test('the page: unique under its printed boxes, and wrongly unique under them transposed', () => {
  assert.deepEqual(solutions(GIVENS, 2, 3), [PRINTED]);
  const transposed = makePuzzle('sudoku', 6); transposed.cells = [...GIVENS]; [transposed.boxRows, transposed.boxCols] = [3, 2];
  assert.equal(conflicts(transposed).size, 0);
  const other = solutions(GIVENS, 3, 2);
  assert.equal(other.length, 1); assert.notDeepEqual(other[0], PRINTED);
});

// A canvas whose 2D context replays translate and rotate on drawImage.
function makeCanvas(width = 600, height = 600, printed = null) {
  const canvas = { width, height, printed };
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const context = new Proxy({
    translate(x, y) { m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    rotate(angle) {
      const cos = Math.round(Math.cos(angle)), sin = Math.round(Math.sin(angle));
      m = { ...m, a: m.a * cos + m.c * sin, b: m.b * cos + m.d * sin, c: -m.a * sin + m.c * cos, d: -m.b * sin + m.d * cos };
    },
    drawImage(source) {
      if (source?.printed) canvas.printed = source.printed.map(p => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
    },
  }, { get: (object, key) => object[key] ?? (() => {}) });
  canvas.getContext = () => context;
  return canvas;
}
// The printed corners of a page lying `quarter` quarter turns clockwise in the
// photograph (1: its top points right; 3: left).
function page(quarter) {
  const frame = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }, { x: 100, y: 500 }];
  return frame.map((_, i) => frame[(i + quarter) % 4]);
}
// The page's cells as a frame shows them with the page lying `quarter`
// quarter turns clockwise: printed cell (r, c) at (c, 5 - r) for one turn.
function framed(cells, quarter) {
  let out = [...cells];
  for (let k = 0; k < quarter; k++) {
    const turned = Array(36).fill(null);
    out.forEach((value, i) => { turned[(i % 6) * 6 + 5 - Math.floor(i / 6)] = value; });
    out = turned;
  }
  return out;
}
// The same corners as the detector reports them: in the image's frame.
function imageFrame(printed) {
  const first = key => [...printed].sort((p, q) => key(p) - key(q))[0];
  return [first(p => p.x + p.y), first(p => p.y - p.x), first(p => -p.x - p.y), first(p => p.x - p.y)].map(p => ({ ...p }));
}
function png(width, height) {
  const bytes = new Uint8Array(45), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  view.setUint32(16, width); view.setUint32(20, height); bytes.set([73, 69, 78, 68], 37);
  return new Blob([bytes], { type: 'image/png' });
}

function harness(t, controls) {
  const originals = ['document', 'window', 'navigator', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { ...makeCanvas(), id, value: '', textContent: '', style: {}, dataset: {}, hidden: false,
      checked: false, addEventListener() {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {},
      pause() {}, load() {}, async play() {} });
    return nodes.get(id);
  };
  for (const id of ['scan-diagnostics', 'live-diagnostics'])
    $(id).querySelector = selector => $(id + '/' + selector.match(/"(.+)"/)[1]);
  globalThis.document = { createElement: () => makeCanvas(), addEventListener() {}, removeEventListener() {},
    body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) } } });
  let next = null, captured = null;
  // The next file's decoded picture: the page, lying as the photograph shows it.
  globalThis.createImageBitmap = async () => ({ width: 600, height: 600, printed: next, close() {} });
  const puzzle = makePuzzle('sudoku', 9);
  const state = { puzzle, photo: null, corners: null, uncertain: new Set(), cageUncertain: new Set(), blackReadings: [],
    notes: [], history: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [] };
  const fields = [['rows', 'rows'], ['cols', 'cols'], ['boxRows', 'box-rows'], ['boxCols', 'box-cols']];
  const setLayout = layout => {
    state.layout = Object.fromEntries(fields.map(([key, id]) => { $(id).value = String(layout[key]); return [key, layout[key]]; }));
  };
  setLayout(controls); $('puzzle-type').value = 'sudoku'; $('auto-solve').checked = true;
  let epoch = 0;
  const errors = [], turns = [], solved = [];
  const stopTask = () => ++epoch;
  const flow = setupPhotoFlow({ $, state, scanner: {
    detect: async canvas => ({ rows: 6, cols: 6, confidence: 0.99, corners: imageFrame(canvas.printed) }),
    read: async (image, quad) => {
      const top = image.printed[0],
        turn = quad.map(p => Math.hypot(p.x - top.x, p.y - top.y)).reduce((best, d, i, all) => d < all[best] ? i : best, 0);
      turns.push(turn);
      const read = makePuzzle('sudoku', 6); read.cells = [...GIVENS];
      return { puzzle: read, turns: turn, notes: turn ? ['The photograph was read turned.'] : [], cellUncertain: [],
        uncertain: [], cageUncertain: [], blackReadings: [], needsReview: false, rectified: makeCanvas() };
    },
  }, stopTask, invalidate: stopTask, begin: stopTask, finish() {}, fail: error => errors.push(error.message),
  render: () => setLayout(state.layout || state.puzzle), status() {}, drawBoard() {},
  remember: () => rememberEdit(state), persist() {}, clearPhotoMapping() { state.rectified = state.photoSource = null; },
  solveNow() {
    const { boxRows, boxCols, cells } = state.puzzle, all = solutions(cells, boxRows, boxCols);
    solved.push({ boxes: [boxRows, boxCols], unique: all.length === 1, printed: all.length === 1 && String(all[0]) === String(PRINTED) });
  },
  boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline() {}, savePicture: async () => true,
  // The live camera: Save picture keeps `captured`.
  liveFactory: () => ({ start() {}, stop() {}, capture: () => captured,
    diagnosticSource: () => ({ image: captured.photo, verified: true }) }) });
  t.after(() => {
    flow.stopCamera();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { $, state, errors, turns, solved, setLayout,
    controls: () => fields.map(([, id]) => Number($(id).value)),
    boxes: () => [state.puzzle.boxRows, state.puzzle.boxCols],
    // A new photograph of the page lying `quarter` turns round, through the file input.
    async photograph(quarter) {
      next = page(quarter);
      await $('photo-file').onchange({ target: { files: [png(600, 600)], value: 'photo' } });
      assert.deepEqual(errors, []);
    },
    async read() {
      const before = turns.length;
      $('read-photo').onclick(); await tick();
      assert.deepEqual(errors, []); assert.equal(turns.length, before + 1, 'the reader ran');
    },
    // A live capture of the page lying `quarter` turns round, handed to the
    // editor with Review captured clues. The live camera reads the grid as the
    // frame shows it, through the tracker's corners in the image's frame, with
    // the box controls as set, and never turns (live-camera.js): its reading
    // is the page turned, under review.
    async capture(quarter, reading = {}) {
      const printed = page(quarter), puzzle = makePuzzle('sudoku', 6);
      [puzzle.boxRows, puzzle.boxCols] = [Number($('box-rows').value), Number($('box-cols').value)];
      puzzle.cells = framed(GIVENS, quarter);
      captured = { photo: makeCanvas(600, 600, printed), annotated: makeCanvas(), corners: imageFrame(printed), createdAt: 1,
        found: { puzzle, notes: [], rectified: makeCanvas(), cellUncertain: [], cageUncertain: [], blackReadings: [],
          needsReview: true, ...reading } };
      await $('camera').onclick(); $('take-photo').onclick(); await tick();
      $('use-live-capture').onclick(); await tick();
      assert.deepEqual(errors, []);
    },
    async findGrid() { await $('detect-photo').onclick(); },
    async rotate() { $('rotate-photo').onclick(); await tick(); await tick(); },
    undo() { restoreEdit(state, state.history.pop()); setLayout(state.layout || state.puzzle); },
  };
}
// The board has the printed boxes, nothing asks for review, and the automatic
// solve found the printed puzzle's solution.
function solvedAsPrinted(h, solves) {
  assert.deepEqual(h.boxes(), [2, 3]);
  assert.deepEqual(h.controls(), [6, 6, 2, 3]);
  assert.equal(h.state.needsReview, false); assert.equal(h.state.uncertain.size, 0);
  assert.equal(h.solved.length, solves);
  assert.deepEqual(h.solved.at(-1), { boxes: [2, 3], unique: true, printed: true });
}
const printedControls = { rows: 6, cols: 6, boxRows: 2, boxCols: 3 };

for (const quarter of [1, 3]) {
  test(`a page lying ${quarter} quarter turns round: Read turns, Read again does not, both with the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.photograph(quarter); await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 1);
    await h.read();
    assert.equal(h.turns.at(-1), 0); solvedAsPrinted(h, 2);
  });
  test(`Find grid after a Read turned ${quarter}: the next Read turns again and keeps the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.photograph(quarter); await h.read(); solvedAsPrinted(h, 1);
    await h.findGrid();
    assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 2);
  });
  test(`the next photograph, lying the same way after a Read turned ${quarter}, keeps the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.photograph(quarter); await h.read(); solvedAsPrinted(h, 1);
    const first = h.state.photo;
    await h.photograph(quarter);
    assert.notEqual(h.state.photo, first); assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 2);
  });
  test(`Undo of a Read turned ${quarter}, then Read again, keeps the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.photograph(quarter); await h.read(); solvedAsPrinted(h, 1);
    h.undo();
    assert.deepEqual(h.state.corners, imageFrame(page(quarter)));
    assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 2);
  });
}
for (const quarter of [1, 3])
  test(`an upright photograph, then the next one lying ${quarter} quarter turns round: both keep the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.photograph(0); await h.read();
    assert.equal(h.turns.at(-1), 0); solvedAsPrinted(h, 1);
    await h.photograph(quarter); await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 2);
  });
test('Rotate that turns a sideways page upright keeps the printed boxes', async t => {
  const h = harness(t, printedControls);
  await h.photograph(3); await h.read(); solvedAsPrinted(h, 1);
  await h.rotate();
  assert.deepEqual(h.controls(), [6, 6, 2, 3]);
  await h.read();
  assert.equal(h.turns.at(-1), 0); solvedAsPrinted(h, 2);
});
test('Rotate that turns a sideways page upside down keeps the printed boxes, and the half turn waits for review', async t => {
  const h = harness(t, printedControls);
  await h.photograph(1); await h.read(); solvedAsPrinted(h, 1);
  await h.rotate();
  assert.deepEqual(h.controls(), [6, 6, 2, 3]);
  await h.read();
  assert.equal(h.turns.at(-1), 2);
  assert.deepEqual(h.boxes(), [2, 3]); assert.equal(h.state.needsReview, true); assert.equal(h.solved.length, 1);
});
// photo-geometry-2: a layout suggested from the grid size is that size's
// standard one, the printed puzzle's, upright: a turned Read keeps it.
for (const quarter of [1, 3])
  test(`a box layout suggested from the grid size stays the standard 2 × 3 through a Read turned ${quarter}`, async t => {
    const h = harness(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
    await h.photograph(quarter);
    assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    await h.read();
    assert.equal(h.turns.at(-1), quarter);
    assert.deepEqual(h.boxes(), [2, 3]); assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    assert.equal(h.state.needsReview, true); assert.equal(h.solved.length, 0);
    assert.match(h.state.notes.join(' '), /Box layout 2 rows × 3 columns was suggested from the grid size/);
    await h.read();
    assert.deepEqual(h.boxes(), [2, 3]); assert.equal(h.state.needsReview, true);
    assert.match(h.state.notes.join(' '), /Box layout 2 rows × 3 columns was suggested from the grid size/);
  });
// A suggestion that a half-turned Read came with stays as it is, still to
// confirm: the repeat Reads, upright now that the crop turned with the first,
// ask again and solve nothing.
test('a box layout suggested from the grid size survives a half-turned Read: the repeat Reads still ask to confirm it', async t => {
  const h = harness(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  await h.photograph(2);
  assert.deepEqual(h.controls(), [6, 6, 2, 3]);
  await h.read();
  assert.equal(h.turns.at(-1), 2);
  for (const repeat of [false, true, true]) {
    if (repeat) { await h.read(); assert.equal(h.turns.at(-1), 0); }
    assert.deepEqual(h.boxes(), [2, 3]); assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    assert.equal(h.state.needsReview, true); assert.equal(h.solved.length, 0);
    assert.match(h.state.notes.join(' '), /Box layout 2 rows × 3 columns was suggested from the grid size/);
  }
});
// A live capture of a sideways page keeps the boxes as set, the printed ones,
// on the camera's frame. Turned upright in the editor, by Rotate or by the
// Read's own quarter turn, the page is read with them.
for (const quarter of [1, 3]) {
  test(`a live capture of a page lying ${quarter} quarter turns round, turned upright by Rotate, is read with the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.capture(quarter);
    assert.deepEqual(h.boxes(), [2, 3]); assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    assert.equal(h.state.needsReview, true); assert.deepEqual(h.state.puzzle.cells, framed(GIVENS, quarter));
    for (let press = quarter; press < 4; press++) {
      await h.rotate();
      assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    }
    await h.read();
    assert.equal(h.turns.at(-1), 0); solvedAsPrinted(h, 1);
  });
  test(`a live capture of a page lying ${quarter} quarter turns round, read again as it lies, is turned with the printed boxes`, async t => {
    const h = harness(t, printedControls);
    await h.capture(quarter);
    await h.read();
    assert.equal(h.turns.at(-1), quarter); solvedAsPrinted(h, 1);
  });
}
// A live reading of a sideways page reads its glyphs wider than tall and few
// clues with confidence, which makes Review captured clues read the still
// again as a photograph: turned upright, with the printed boxes, and under
// review like every capture.
for (const quarter of [1, 3])
  test(`a live capture of a page lying ${quarter} quarter turns round whose reading shows the turn is read again upright, with the printed boxes`, async t => {
    const h = harness(t, printedControls), cells = framed(GIVENS, quarter), clues = cells.flatMap((v, i) => v === null ? [] : [i]);
    const entries = clues.map(cell => ({ kind: 'value', cell, text: String(cells[cell]), confidence: 40, h: 20, w: 30 }));
    await h.capture(quarter, { entries, cellUncertain: clues, uncertain: clues, notes: ['10 cells need checking.'] });
    await tick();
    assert.deepEqual(h.turns, [quarter], 'the still was read again, and turned');
    assert.deepEqual(h.state.puzzle.cells, GIVENS);
    assert.deepEqual(h.boxes(), [2, 3]); assert.deepEqual(h.controls(), [6, 6, 2, 3]);
    assert.equal(h.state.needsReview, true); assert.equal(h.solved.length, 0);
    assert.match(h.state.notes[0], /read turned/);
  });
