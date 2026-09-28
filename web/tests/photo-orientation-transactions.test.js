import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhotoFlow } from '../photo-flow.js';
import { boxShape, conflicts, fitPlay, makePuzzle } from '../model.js';
import { turnCorners } from '../geometry.js';
import { rememberEdit, restoreEdit } from '../edit-history.js';
import { restoreSession, saveSession } from '../session.js';

// Exercise the production photo transaction with controlled recognizer/DOM
// I/O. These are rules, ownership and persistence tests, not OCR measurements.
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function canvas(width = 600, height = 600) {
  const context = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}) });
  return { width, height, getContext: () => context };
}
function reading(type = 'sudoku', size = 6, turns = 1, boxes = [2, 3]) {
  const puzzle = makePuzzle(type, size);
  [puzzle.boxRows, puzzle.boxCols] = boxes;
  puzzle.cells = Array.from({ length: size * size }, (_, cell) => {
    const row = Math.floor(cell / size);
    return (Math.floor(row / boxes[0]) + (row % boxes[0]) * boxes[1] + cell % size) % size + 1;
  });
  if (type === 'killersudoku') puzzle.cages = Array.from({ length: size }, (_, row) => ({
    cells: Array.from({ length: size }, (_, col) => row * size + col),
    op: '+', target: size * (size + 1) / 2,
  }));
  return { puzzle, turns, notes: ['Check the photographed clues.'], needsReview: true,
    cellUncertain: [0], cageUncertain: [1], blackReadings: [], rectified: canvas() };
}
function harness(t, { type = 'sudoku', choice = type, size = 6, boxes = [3, 2] } = {}) {
  const originals = ['document', 'window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { ...canvas(), value: '', style: {}, dataset: {}, checked: false,
      addEventListener() {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {} });
    return nodes.get(id);
  };
  for (const id of ['scan-diagnostics', 'live-diagnostics'])
    $(id).querySelector = selector => $(id + '/' + selector.match(/"(.+)"/)[1]);
  globalThis.document = { createElement: () => canvas(), addEventListener() {}, removeEventListener() {},
    body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const puzzle = makePuzzle(type, size), corners = [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }];
  [puzzle.boxRows, puzzle.boxCols] = boxes;
  const state = { puzzle, photo: canvas(), corners, uncertain: new Set(), cageUncertain: new Set(),
    blackReadings: [], notes: [], history: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [],
    puzzleSource: 1, photoSource: 1, result: { status: 'unique' }, rectified: canvas() };
  const fields = [['rows', 'rows'], ['cols', 'cols'], ['boxRows', 'box-rows'], ['boxCols', 'box-cols']];
  const setLayout = layout => {
    state.layout = Object.fromEntries(fields.map(([key, id]) => { $(id).value = String(layout[key]); return [key, layout[key]]; }));
  };
  setLayout(puzzle); $('puzzle-type').value = choice;
  const errors = [], queue = [], calls = [];
  let epoch = 0, saved = null, detection = null;
  const stopTask = () => ++epoch;
  const storage = { set: (_key, value) => { saved = value; }, get: () => saved };
  const flow = setupPhotoFlow({ $, state, scanner: {
    read: async (...args) => { calls.push(args); return queue.shift(); },
    detect: async () => detection,
  }, stopTask, invalidate: stopTask, begin: stopTask, finish() {}, fail: error => errors.push(error),
  render: () => setLayout(state.layout || state.puzzle), status() {}, drawBoard() {},
  remember: () => rememberEdit(state), persist: () => saveSession(storage, state),
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() {},
  boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline() {} });
  t.after(() => {
    flow.stopCamera();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { $, state, corners, errors, calls, storage, stopTask, setLayout,
    read: async value => { queue.push(value); $('read-photo').onclick(); await tick(); },
    detect: async n => { detection = { rows: n, cols: n, corners, confidence: .99 }; await $('detect-photo').onclick(); },
  };
}
function layoutIs(h, boxes, size = 6) {
  assert.deepEqual([h.state.puzzle.boxRows, h.state.puzzle.boxCols], boxes);
  assert.deepEqual(h.state.layout, { rows: size, cols: size, boxRows: boxes[0], boxCols: boxes[1] });
  assert.deepEqual([Number(h.$('box-rows').value), Number(h.$('box-cols').value)], boxes);
}
for (const type of ['sudoku', 'killersudoku']) for (const choice of [type, 'auto']) for (const turns of [1, 3])
  test(`${choice} → ${type}, turn ${turns}: boxes, controls, corners and autosave rotate together`, async t => {
    const h = harness(t, { type, choice }), found = reading(type, 6, turns);
    await h.read(found);
    assert.deepEqual(h.errors, []); layoutIs(h, [2, 3]);
    assert.deepEqual(h.state.corners, turnCorners(h.corners, turns));
    assert.equal(conflicts(h.state.puzzle).size, 0);
    assert.equal(h.state.rectified, found.rectified);
    assert.deepEqual([...h.state.uncertain], [0]); assert.deepEqual([...h.state.cageUncertain], [1]);
    assert.equal(h.state.needsReview, true);
    assert.deepEqual(restoreSession(h.storage).puzzle, h.state.puzzle);
    assert.equal(h.state.history.length, 1);
    restoreEdit(h.state, h.state.history.pop());
    h.setLayout(h.state.layout); layoutIs(h, [3, 2]);
  });
for (const size of [4, 9]) test(`${size}×${size} square boxes stay unchanged`, async t => {
  const boxes = boxShape(size), h = harness(t, { size, boxes });
  await h.read(reading('sudoku', size, 3, boxes)); layoutIs(h, boxes, size);
  assert.equal(conflicts(h.state.puzzle).size, 0); assert.deepEqual(h.errors, []);
});
for (const turns of [0, 2]) test(`turn ${turns} does not transpose rectangular boxes`, async t => {
  const h = harness(t); await h.read(reading('sudoku', 6, turns, [3, 2]));
  layoutIs(h, [3, 2]); assert.deepEqual(h.errors, []);
});
test('repeat Read uses the already rotated layout and crop, without rotating twice', async t => {
  const h = harness(t); await h.read(reading()); const corners = structuredClone(h.state.corners);
  await h.read(reading('sudoku', 6, 0)); layoutIs(h, [2, 3]);
  assert.deepEqual(h.state.corners, corners); assert.deepEqual(h.calls[1][1], corners);
  assert.equal(conflicts(h.state.puzzle).size, 0); assert.deepEqual(h.errors, []);
});
test('suggested-box warning rotates and survives a repeat Read', async t => {
  const h = harness(t, { size: 4, boxes: [2, 2] }); await h.detect(6);
  for (const turns of [1, 0]) {
    const found = reading('sudoku', 6, turns, [3, 2]);
    found.needsReview = false; found.cellUncertain = []; found.cageUncertain = [];
    await h.read(found); layoutIs(h, [3, 2]);
    assert.equal(h.state.needsReview, true);
    assert.match(h.state.notes.join(' '), /Box layout 3 rows × 2 columns was suggested/);
    assert.match(restoreSession(h.storage).notes.join(' '), /Box layout 3 rows × 2 columns was suggested/);
  }
  assert.deepEqual(h.errors, []);
});
for (const kind of ['invalid', 'cancelled']) test(`${kind} candidate leaves layout, proposal, crop and accepted state untouched`, async t => {
  const h = harness(t, { size: 4, boxes: [2, 2] }); await h.detect(6);
  const before = { puzzle: h.state.puzzle, layout: structuredClone(h.state.layout), corners: h.state.corners,
    result: h.state.result, history: [...h.state.history] };
  if (kind === 'invalid') {
    const found = reading(); found.puzzle.cells.pop(); await h.read(found); assert.equal(h.errors.length, 1);
  } else {
    const pending = deferred(); await h.read(pending.promise); h.stopTask(); pending.resolve(reading()); await tick();
    assert.deepEqual(h.errors, []);
  }
  for (const key of ['puzzle', 'corners', 'result']) assert.equal(h.state[key], before[key]);
  assert.deepEqual(h.state.layout, before.layout); assert.deepEqual(h.state.history, before.history);
  assert.equal(h.storage.get(), null);
  await h.read(reading('sudoku', 6, 3, [3, 2])); layoutIs(h, [3, 2]);
  assert.match(h.state.notes.join(' '), /Box layout 3 rows × 2 columns was suggested/);
});
test('the successful rotated candidate uses snapshotted boxes, not controls edited while awaiting OCR', async t => {
  const h = harness(t), pending = deferred(); await h.read(pending.promise);
  h.setLayout({ rows: 6, cols: 6, boxRows: 1, boxCols: 6 });
  pending.resolve(reading()); await tick(); layoutIs(h, [2, 3]); assert.deepEqual(h.errors, []);
});
