import test from 'node:test';
import assert from 'node:assert/strict';
import { Scanner } from '../scanner.js';
import { makePuzzle } from '../model.js';

// The real read()/orient() control flow, with completed/failed readOnce calls.
// No OCR implementation or confidence threshold is replaced.
const corners = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }];
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function reading(count, sideways = false) {
  const puzzle = makePuzzle('sudoku', 4), values = [1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1];
  puzzle.cells = values.map((value, cell) => cell < count ? value : null);
  const cellUncertain = Array.from({ length: 12 }, (_, cell) => cell).filter(cell => cell >= count);
  return { puzzle, cellUncertain, uncertain: cellUncertain, needsReview: true, notes: ['Check the clues.'],
    entries: Array.from({ length: 12 }, (_, cell) => ({ kind: 'value', cell, w: sideways ? 20 : 10, h: sideways ? 10 : 20 })) };
}
function harness(t, steps) {
  const scanner = new Scanner(), calls = [];
  scanner.readOnce = async (...args) => {
    const step = steps[calls.length]; calls.push(args);
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(...args) : step;
  };
  t.after(() => scanner.cancel());
  return { scanner, calls, read: (options = {}, progress = () => {}) => scanner.read({}, corners, 'sudoku', 4, 4, progress, options) };
}
const failure = () => Error('No printed clues found. Adjust the crop, dimensions or lighting.');
test('a failed second trial preserves the better completed first trial', async t => {
  const best = reading(10), h = harness(t, [reading(1, true), best, failure()]);
  const result = await h.read(); assert.equal(result.puzzle, best.puzzle); assert.equal(result.turns, 1);
  assert.equal(h.calls.length, 3); assert.equal(result.needsReview, true);
});
test('a failed first trial still tries and selects the other orientation', async t => {
  const best = reading(10), h = harness(t, [reading(1, true), failure(), best]);
  const result = await h.read(); assert.equal(result.puzzle, best.puzzle); assert.equal(result.turns, 3);
  assert.equal(h.calls.length, 3);
});
test('two failed trials return the original completed reading unchanged', async t => {
  const original = reading(1, true), h = harness(t, [original, failure(), failure()]);
  assert.equal(await h.read(), original); assert.equal(h.calls.length, 3);
});
test('a surviving but insufficient improvement still returns the original', async t => {
  const original = reading(1, true), h = harness(t, [original, failure(), reading(7)]);
  assert.equal(await h.read(), original); assert.equal(h.calls.length, 3);
});
test('two successful trials still select the strongest reading', async t => {
  const best = reading(11), h = harness(t, [reading(1, true), reading(9), best]);
  const result = await h.read(); assert.equal(result.puzzle, best.puzzle); assert.equal(result.turns, 3);
});
test('failure of the initial read is not optional', async t => {
  const error = failure(), h = harness(t, [error]);
  await assert.rejects(h.read(), value => value === error); assert.equal(h.calls.length, 1);
});
for (const at of [1, 2]) test(`AbortError in trial ${at} never falls back to an earlier reading`, async t => {
  const error = Object.assign(failure(), { name: 'AbortError' }), steps = [reading(1, true), reading(10), reading(11)];
  steps[at] = error; const h = harness(t, steps);
  await assert.rejects(h.read(), value => value === error); assert.equal(h.calls.length, at + 1);
});
for (const outcome of ['resolve', 'reject']) test(`cancelled trial's late ${outcome} cannot return the earlier reading`, async t => {
  const pending = deferred(), h = harness(t, [reading(1, true), reading(10), pending.promise]);
  const result = h.read(), rejected = assert.rejects(result, { name: 'AbortError' });
  await tick(); assert.equal(h.calls.length, 3); h.scanner.cancel();
  if (outcome === 'resolve') pending.resolve(reading(11)); else pending.reject(failure());
  await rejected; assert.equal(h.calls.length, 3);
});
for (const outcome of ['resolve', 'reject']) test(`new Read supersedes an older trial even when it later ${outcome}s`, async t => {
  const pending = deferred(), next = reading(11), h = harness(t, [reading(1, true), pending.promise, next]);
  const old = h.read(), rejected = assert.rejects(old, { name: 'AbortError' });
  await tick(); assert.equal(h.calls.length, 2);
  assert.equal(await h.read({ orient: false }), next);
  if (outcome === 'resolve') pending.resolve(reading(10)); else pending.reject(failure());
  await rejected; assert.equal(h.calls.length, 3);
});
test('cancellation from progress stops before another orientation request starts', async t => {
  const h = harness(t, [reading(1, true)]);
  await assert.rejects(h.read({}, () => h.scanner.cancel()), { name: 'AbortError' });
  assert.equal(h.calls.length, 1);
});
for (const options of [{ orient: false }, { cells: [0] }]) test(`orientation remains bypassed for ${JSON.stringify(options)}`, async t => {
  const original = reading(1, true), h = harness(t, [original]);
  assert.equal(await h.read(options), original); assert.equal(h.calls.length, 1);
});
test('rectangular grids do not start quarter-turn trials', async t => {
  const original = reading(1, true), h = harness(t, [original]);
  assert.equal(await h.scanner.read({}, corners, 'hidato', 4, 3), original); assert.equal(h.calls.length, 1);
});
test('a cancelled initial result is rejected even when orientation would be bypassed', async t => {
  const pending = deferred(), h = harness(t, [pending.promise]);
  const result = h.read({ orient: false }), rejected = assert.rejects(result, { name: 'AbortError' });
  h.scanner.cancel(); pending.resolve(reading(11)); await rejected;
});
