import test from 'node:test';
import assert from 'node:assert/strict';

const settle = () => new Promise((resolve) => setImmediate(resolve));
let instance = 0;
async function harness(t) {
  // A fresh queue per test also isolates the intentionally failing baseline run.
  const { photoDetail, retainPhotoSource } = await import(`../photo-detail.js?queue-test=${++instance}`);
  const old = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  const decodes = [], reads = [], canvases = [];
  let active = 0, maximum = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.createImageBitmap = (file) => {
    maximum = Math.max(maximum, ++active);
    return new Promise((resolve, reject) => {
      const bitmap = { width: 2400, height: 1800, closed: false, close() { this.closed = true; } };
      let finished = false;
      decodes.push({ file, bitmap, finish(error) {
        if (finished) return;
        finished = true; active--;
        if (error) reject(error); else resolve(bitmap);
      } });
    });
  };
  globalThis.document = { createElement() {
    const canvas = { getContext: () => ({ fillRect() {}, translate() {}, rotate() {}, drawImage() {} }) };
    canvases.push(canvas); return canvas;
  } };
  t.after(async () => {
    // Release even a deliberately failing test's decoder without leaking a queue,
    // an unhandled rejection, or a real 15-second timer into the next test.
    for (const read of reads) read.current = false;
    for (const decode of decodes) decode.finish();
    t.mock.timers.tick(15000);
    await Promise.all(reads.map((read) => read.done));
    for (const read of reads) read.outcome?.result?.release();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return {
    decodes, canvases,
    get active() { return active; },
    get maximum() { return maximum; },
    async advance(ms) { t.mock.timers.tick(ms); await settle(); },
    read() {
      const file = {}, preview = retainPhotoSource({ width: 800, height: 600 }, file, { width: 2400, height: 1800 });
      const corners = [{ x: 0, y: 0 }, { x: 799, y: 0 }, { x: 799, y: 599 }, { x: 0, y: 599 }];
      const read = { file, preview, corners, current: true, outcome: null };
      read.done = photoDetail(preview, corners, { current: () => read.current }).then(
        (result) => (read.outcome = { result }), (error) => (read.outcome = { error }));
      reads.push(read); return read;
    },
  };
}
function assertFallback(read) {
  assert.equal(read.outcome?.result?.enhanced, false);
  assert.equal(read.outcome.result.image, read.preview);
  assert.equal(read.outcome.result.corners, read.corners);
  assert.match(read.outcome.result.note, /recognition uses the preview/);
}

for (const cancelled of [false, true]) for (const failure of [false, true]) {
  test(`${cancelled ? 'cancelled' : 'timed-out'} waiter cannot release a pending decode before ${failure ? 'rejection' : 'completion'}`, async (t) => {
    const h = await harness(t), first = h.read();
    await settle(); assert.equal(h.decodes.length, 1);
    const skipped = h.read(); skipped.current = !cancelled;
    await h.advance(15000);
    if (cancelled) assert.equal(skipped.outcome?.error?.name, 'AbortError');
    else assertFallback(skipped);
    assert.equal(h.canvases.length, 0);

    const next = h.read();
    await settle();
    assert.equal(h.decodes.length, 1, 'a released waiter must not bypass the unfinished original decode');
    assert.equal(next.outcome, null);
    h.decodes[0].finish(failure ? Error('decoder failed') : undefined);
    await first.done; await settle();
    if (failure) assertFallback(first);
    else {
      assert.equal(first.outcome.result.enhanced, true);
      assert.equal(h.decodes[0].bitmap.closed, true);
    }
    assert.equal(h.decodes.length, 2);
    assert.equal(h.decodes[1].file, next.file, 'the skipped read must never decode later');
    h.decodes[1].finish(); await next.done;
    assert.equal(next.outcome.result.enhanced, true);
    assert.equal(h.decodes[1].bitmap.closed, true);
    assert.equal(h.active, 0); assert.equal(h.maximum, 1);
  });
}

test('a successor already queued when its predecessor times out still waits for the original decode', async (t) => {
  const h = await harness(t), first = h.read();
  await settle();
  const skipped = h.read();
  await h.advance(10000);
  const next = h.read();
  await h.advance(5000);
  assertFallback(skipped);
  assert.equal(next.outcome, null);
  assert.equal(h.decodes.length, 1);
  h.decodes[0].finish(); await first.done; await settle();
  assert.equal(h.decodes.length, 2); assert.equal(h.decodes[1].file, next.file);
  h.decodes[1].finish(); await next.done;
  assert.equal(next.outcome.result.enhanced, true); assert.equal(h.maximum, 1);
});

test('repeated waiter timeouts retain the real decode owner and preserve FIFO recovery', async (t) => {
  const h = await harness(t), first = h.read();
  await settle();
  for (let i = 0; i < 3; i++) {
    const skipped = h.read();
    await settle(); assert.equal(h.decodes.length, 1);
    await h.advance(14999); assert.equal(skipped.outcome, null);
    await h.advance(1); assertFallback(skipped);
    assert.equal(h.active, 1); assert.equal(h.canvases.length, 0);
  }
  const next = h.read(), last = h.read();
  await settle(); assert.equal(h.decodes.length, 1);
  first.current = false;
  h.decodes[0].finish(); await first.done; await settle();
  assert.equal(first.outcome.error.name, 'AbortError');
  assert.equal(h.decodes[0].bitmap.closed, true, 'a late cancelled decode must close its bitmap');
  assert.equal(h.canvases.length, 0, 'a cancelled decode must not allocate a crop');
  assert.equal(h.decodes.length, 2); assert.equal(h.decodes[1].file, next.file);
  h.decodes[1].finish(); await next.done; await settle();
  assert.equal(h.decodes[1].bitmap.closed, true);
  assert.equal(h.decodes.length, 3); assert.equal(h.decodes[2].file, last.file);
  h.decodes[2].finish(); await last.done;
  assert.equal(next.outcome.result.enhanced, true); assert.equal(last.outcome.result.enhanced, true);
  assert.equal(h.decodes[2].bitmap.closed, true);
  assert.equal(h.active, 0); assert.equal(h.maximum, 1);
});
