import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSession } from '../live-session.js';
import { makePuzzle } from '../model.js';

// Real session state machine; controlled OCR, solver, identity proofs and time.
// This tests ownership/rollback, not recognition accuracy.
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function reading(partial = false) {
  const puzzle = makePuzzle('sudoku', 4);
  puzzle.cells = [1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,null];
  const markedCells = puzzle.cells.flatMap((v, i) => v === null ? [] : [i]);
  if (partial) puzzle.cells.fill(null, 1);
  return { puzzle, needsReview: true, markedCells, refining: partial,
    cellUncertain: partial ? markedCells : [], uncertain: partial ? markedCells : [] };
}
function harness() {
  let clock = 0, enabled = true, current = true, serial = 0, reads = 0, solves = 0, cancelled = 0;
  const requests = [], timers = new Map(), statuses = [], events = [], hidden = new Set();
  const frame = (sharpness = 100, scene = 'original') => ({ key: 'sudoku-4', scene, sharpness,
    corners: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], image: {width:100,height:100} });
  const session = createLiveSession({
    read(sample, progress, partial) {
      reads++;
      return new Promise((resolve, reject) => requests.push({ sample, progress, partial, resolve, reject }));
    },
    readCells: async () => { throw Error('No uncertain targets in the accepted reading'); },
    solve: async () => { solves++; return { status: 'unique', complete: true,
      solutions: [{ cells: [...reading().puzzle.cells.slice(0, 15), 1] }] }; },
    cancelRead() { cancelled++; }, cancelSolve() {},
    onChange() {}, onStatus: value => statuses.push(value), onEvent: value => events.push(value),
    isCurrent: sample => current && !hidden.has(sample), sameScene: (a, b) => a.scene === b.scene,
    autoSolve: () => enabled, now: () => clock,
    setTimer: callback => { const id = ++serial; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { session, requests, timers, statuses, events, hidden, frame,
    get reads() { return reads; }, get solves() { return solves; }, get cancelled() { return cancelled; },
    set current(value) { current = value; }, set enabled(value) { enabled = value; },
    tick(value) { clock = value; },
    async acquire() {
      session.start(); session.observe(frame()); session.observe(frame());
      assert.equal(reads, 1);
      requests[0].resolve(reading()); await drain();
      assert.equal(session.preview.result.status, 'unique');
      assert.equal(session.settled, true);
      return session.preview;
    },
    retry() { clock = 2000; session.observe(frame(200)); assert.equal(reads, 2); return requests[1]; },
    expire() { assert.equal(timers.size, 1); [...timers.values()][0](); },
  };
}
function preserved(h, before) {
  assert.deepEqual(h.session.preview.found.puzzle.cells, before.found.puzzle.cells);
  assert.equal(h.session.preview.result, before.result);
  assert.equal(h.session.settled, true);
  assert.equal(h.session.busy, false);
  assert.equal(h.timers.size, 0);
}
for (const outcome of ['error', 'abort', 'timeout', 'invalid']) {
  test(`full retry preserves the accepted reading after partial output and ${outcome}`, async () => {
    const h = harness(), before = await h.acquire(), request = h.retry(), image = request.sample.image;
    request.partial(reading(true));
    // Candidate ink must not replace the completed reading/solution yet, and
    // both anchors must remain retained while the request is running.
    assert.equal(h.session.preview.found, before.found);
    assert.ok(h.session.trackingFrames.includes(before.sample));
    assert.ok(h.session.proofFrames.includes(before.sample));
    assert.ok(h.session.proofFrames.includes(request.sample));
    if (outcome === 'timeout') h.expire();
    else if (outcome === 'invalid') request.resolve({ puzzle: { rows: -1 } });
    else request.reject(Object.assign(new Error('Injected failure'), { name: outcome === 'abort' ? 'AbortError' : 'Error' }));
    await drain(); preserved(h, before);
    assert.equal(image.width, 0); assert.equal(image.height, 0);
    const status = h.statuses.at(-1);
    request.partial(reading(true)); request.progress('late progress'); request.resolve(reading(true));
    await drain(); preserved(h, before); assert.equal(h.statuses.at(-1), status);
  });
}
test('failure before partial output also preserves the accepted reading', async () => {
  const h = harness(), before = await h.acquire(), request = h.retry();
  request.reject(new Error('Injected failure')); await drain(); preserved(h, before);
});
test('a successful retry commits only its completed reading and re-solves', async () => {
  const h = harness(), before = await h.acquire(), request = h.retry();
  request.partial(reading(true)); assert.equal(h.session.preview.found, before.found);
  const next = reading(); next.puzzle.cells[14] = null; next.markedCells = next.markedCells.filter(cell => cell !== 14);
  request.resolve(next); await drain();
  assert.equal(h.session.preview.found, next); assert.equal(h.solves, 2);
  assert.equal(h.session.anchorFrame, request.sample);
  const status = h.statuses.at(-1);
  request.partial(reading(true)); request.progress('late success progress');
  assert.equal(h.session.preview.found, next); assert.equal(h.statuses.at(-1), status);
});
test('retention never grants the retry frame permission to display the old reading', async () => {
  const h = harness(), before = await h.acquire(), request = h.retry();
  h.hidden.add(before.sample); h.session.motion(); assert.equal(h.session.preview, null);
  // The new frame is still verified, but it cannot vouch for the old anchor.
  request.partial(reading(true)); request.reject(new Error('Injected failure')); await drain();
  assert.equal(h.session.preview, null);
  h.hidden.clear(); h.session.motion(); preserved(h, before);
});
test('a completed retry received during movement stays hidden until its own proof returns', async () => {
  const h = harness(); await h.acquire(); const request = h.retry(), next = reading();
  h.hidden.add(request.sample); request.resolve(next); await drain();
  assert.equal(h.session.preview, null); assert.equal(h.solves, 1);
  h.hidden.clear(); h.session.motion(); await drain();
  assert.equal(h.session.preview.found, next); assert.equal(h.solves, 2);
});
for (const invalidation of ['stop', 'settings', 'content', 'loss']) {
  test(`${invalidation} invalidation never restores the retry's previous reading`, async () => {
    const h = harness(); await h.acquire(); const request = h.retry();
    request.partial(reading(true));
    if (invalidation === 'stop') h.session.stop();
    if (invalidation === 'settings') h.session.invalidate();
    if (invalidation === 'content') {
      h.session.observe(h.frame(200, 'different'));
      h.session.observe(h.frame(200, 'different'));
    }
    if (invalidation === 'loss') {
      h.current = false; h.session.motion(); h.tick(8000); h.session.motion();
    }
    request.partial(reading(true)); request.progress('late progress'); request.reject(new Error('late failure'));
    await drain();
    assert.equal(h.session.preview, null); assert.equal(h.session.settled, false);
    assert.equal(h.timers.size, 0);
  });
}
test('disabling automatic solving during a retry never resurrects blue answers on failure', async () => {
  const h = harness(); await h.acquire(); const request = h.retry();
  h.enabled = false; h.session.motion(); request.partial(reading(true));
  request.reject(new Error('Injected failure')); await drain();
  assert.equal(h.session.preview.result, null); assert.equal(h.solves, 1);
  assert.deepEqual(h.session.preview.found.puzzle.cells, reading().puzzle.cells);
  h.enabled = true; h.session.motion(); await drain(); assert.equal(h.solves, 2);
});
test('a retired timeout cannot affect a newer retry', async () => {
  const h = harness(); await h.acquire(); const request = h.retry(), oldTimer = [...h.timers.values()][0];
  h.expire(); h.tick(4000); h.session.observe(h.frame(400)); assert.equal(h.reads, 3);
  oldTimer(); request.partial(reading(true)); request.resolve(reading(true)); await drain();
  assert.equal(h.session.busy, true); assert.equal(h.timers.size, 1);
  h.requests[2].resolve(reading()); await drain(); assert.equal(h.session.preview.result.status, 'unique');
});
test('first acquisition still shows partial clues, and its timeout still retires them', async () => {
  const h = harness(); h.session.start(); h.session.observe(h.frame()); h.session.observe(h.frame());
  h.requests[0].partial(reading(true)); assert.equal(h.session.preview.found.refining, true);
  assert.equal(h.session.preview.result, null); assert.equal(h.solves, 0);
  h.expire(); assert.equal(h.session.preview, null);
  h.requests[0].resolve(reading()); await drain(); assert.equal(h.session.preview, null);
});
