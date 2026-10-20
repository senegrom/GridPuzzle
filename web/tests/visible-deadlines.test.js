// Deadlines in visible time (visible-time.js). iOS suspends a hidden page's
// process, workers included, while the clock setTimeout runs on goes on, so a
// plain deadline expired during an app switch and fired on return, before the
// resumed work could finish. A fake page dispatches visibilitychange; Node's
// mock timers move setTimeout and Date together, and nothing runs while the
// page is hidden, as on a suspended phone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { visibleTimers } from "../visible-time.js";
import { createTaskController } from "../task-controller.js";
import { createOCRRuntime } from "../ocr-runtime.js";
import { Scanner } from "../scanner.js";

function page() {
  const listeners = [];
  return {
    hidden: false, listeners,
    addEventListener(type, fn) { if (type === "visibilitychange") listeners.push(fn); },
    hide() { this.hidden = true; for (const fn of listeners) fn(); },
    show() { this.hidden = false; for (const fn of listeners) fn(); },
  };
}
function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  return { now: () => Date.now(), tick: (ms) => t.mock.timers.tick(ms) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a deadline stops while the page is hidden and resumes with the time it had left", (t) => {
  const c = clock(t), p = page(), timers = visibleTimers({ now: c.now, page: p });
  let fired = 0;
  timers.setTimer(() => fired++, 90000);
  c.tick(30000); p.hide();
  c.tick(300000); assert.equal(fired, 0, "nothing expires while the page is hidden");
  p.show(); c.tick(59999); assert.equal(fired, 0);
  c.tick(1); assert.equal(fired, 1, "60 s of visible time were left");
  // Hidden and shown again, in several steps.
  timers.setTimer(() => fired++, 10000);
  for (let i = 0; i < 3; i++) { c.tick(3000); p.hide(); c.tick(60000); p.hide(); p.show(); p.show(); }
  assert.equal(fired, 1); c.tick(1000); assert.equal(fired, 2);
});

test("a deadline set while the page is hidden counts from its return; a cleared one never fires", (t) => {
  const c = clock(t), p = page(), timers = visibleTimers({ now: c.now, page: p });
  const fired = [];
  p.hide();
  timers.setTimer(() => fired.push("late"), 5000);
  const cleared = timers.setTimer(() => fired.push("cleared"), 5000);
  c.tick(20000); timers.clearTimer(cleared); p.show();
  c.tick(4999); assert.deepEqual(fired, []); c.tick(1); assert.deepEqual(fired, ["late"]);
  c.tick(60000); assert.deepEqual(fired, ["late"]);
  timers.clearTimer(null); timers.clearTimer(undefined);
});

test("every deadline on a page shares one listener, and a page without one keeps plain timers", (t) => {
  const c = clock(t), p = page();
  visibleTimers({ page: p }).setTimer(() => {}, 1); visibleTimers({ page: p }).setTimer(() => {}, 1);
  assert.equal(p.listeners.length, 1);
  let fired = 0;
  visibleTimers({ now: c.now, page: undefined }).setTimer(() => fired++, 1000);
  c.tick(1000); assert.equal(fired, 1);
});

// The live-camera browser suite hides the page with an event and makes it
// visible again without one; so may a browser that misses an event.
test("a deadline set while the page is visible resumes those a missed event left stopped", (t) => {
  const c = clock(t), p = page(), timers = visibleTimers({ now: c.now, page: p });
  let fired = 0;
  timers.setTimer(() => fired++, 2000);
  p.hide(); p.hidden = false;
  c.tick(10000); assert.equal(fired, 0);
  timers.setTimer(() => {}, 100000);
  c.tick(2000); assert.equal(fired, 1);
});

// Every new deadline and every visibility change resumes the page's stopped
// deadlines, so one that fired must have left them: it would fire again.
test("a deadline that fired stays fired when later deadlines are set or the page is hidden and shown", (t) => {
  const c = clock(t), p = page(), timers = visibleTimers({ now: c.now, page: p });
  let fired = 0;
  timers.setTimer(() => fired++, 1000); c.tick(1000); assert.equal(fired, 1);
  for (let i = 0; i < 3; i++) { timers.setTimer(() => {}, 5000); c.tick(1000); p.hide(); p.show(); c.tick(1000); }
  c.tick(60000); assert.equal(fired, 1);
});

function tasks(t, p) {
  const nodes = new Map(), $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: false, disabled: false, textContent: "" });
    return nodes.get(id);
  };
  const c = clock(t), controller = createTaskController({ $, scanner: { cancel() {} }, status() {}, onStop() {},
    deadlines: visibleTimers({ now: c.now, page: p }) });
  t.after(() => controller.stop());
  return { c, controller };
}

test("a Read deadline does not run out during an app switch; it still stops a Read stuck while visible", (t) => {
  const p = page(), { c, controller } = tasks(t, p), expired = [];
  controller.begin();
  controller.setDeadline(() => expired.push("read"), 120000);
  c.tick(3000); p.hide(); c.tick(150000); p.show();
  c.tick(116999); assert.deepEqual(expired, []);
  c.tick(1); assert.deepEqual(expired, ["read"]);
  // A newer deadline replaces it, and finishing clears it, paused or not.
  controller.setDeadline(() => expired.push("runtime"), 180000); p.hide();
  controller.setDeadline(() => expired.push("replaced"), 1000); controller.finish(); p.show();
  c.tick(400000); assert.deepEqual(expired, ["read"]);
});

test("the search limit keeps to the clock: it runs out while the page is hidden", (t) => {
  const p = page(), { c, controller } = tasks(t, p), expired = [];
  controller.begin();
  controller.setDeadline(() => expired.push("search"), 30000, { wallClock: true });
  p.hide(); c.tick(30000); assert.deepEqual(expired, ["search"]);
  controller.setDeadline(() => expired.push("cleared"), 30000, { wallClock: true }); controller.clearDeadline();
  c.tick(60000); assert.deepEqual(expired, ["search"]);
});

test("app.js gives the task controller the scanner's visible-time deadlines, but not the search limit", () => {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8"),
    scanner = fs.readFileSync(new URL("../scanner.js", import.meta.url), "utf8");
  assert.match(app, /createTaskController\(\{[^}]*deadlines: scanner\.deadlines,/);
  assert.match(scanner, /this\.deadlines = visibleTimers\(\);/);
  assert.match(app, /Runtime loading timed out[^]*?\}, 180000\);/);
  assert.match(app, /Search limit reached[^]*?\}, seconds \* 1000, \{ wallClock: true \}\);/);
});

// The OCR host worker: a job takes `work` ms of the worker's running time, and
// a suspended phone runs nothing, so the test moves no work while hidden.
function ocr(t, p) {
  const c = clock(t), workers = [];
  const runtime = createOCRRuntime({
    makeWorker() { const w = { messages: [], postMessage(m) { this.messages.push(m); }, terminate() { this.terminated = true; } }; workers.push(w); return w; },
    deadlines: visibleTimers({ now: c.now, page: p }),
  });
  t.after(() => { runtime.dispose(); for (const w of workers) w.onmessage?.({ data: { cancelled: true } }); });
  const job = () => workers.at(-1).messages.findLast((m) => m.id !== undefined);
  return { c, runtime, workers, job, reply: (data) => workers.at(-1).onmessage({ data }) };
}

for (const away of [60000, 120000, 150000])
  test(`an OCR job in flight through an app switch of ${away / 1000} s completes on return`, async (t) => {
    // The review's model: the job starts 1.5 s into a Read and needs 8 s of
    // work; the page is hidden at 3 s. Before, away 120 s or more, its 90 s
    // deadline fell due while hidden and failed the Read on return.
    const p = page(), h = ocr(t, p);
    h.c.tick(1500);
    const result = h.runtime.recognize({ png: "crop" });
    let settled = null;
    result.then((r) => { settled = r; }, (e) => { settled = e; });
    h.c.tick(1500); p.hide(); h.c.tick(away); p.show();
    h.c.tick(6500); await settle();
    assert.equal(settled, null, "nothing has timed out");
    h.reply({ id: h.job().id, result: { text: "5 3 . 7" } });
    assert.deepEqual(await result, { text: "5 3 . 7" });
    assert.equal(h.workers.length, 1); assert.notEqual(h.workers[0].terminated, true);
  });

test("an OCR job stuck while the page is visible still times out after 90 s of visible time", async (t) => {
  const p = page(), h = ocr(t, p), result = h.runtime.recognize({ png: "crop" });
  const failed = assert.rejects(result, { message: "Printed-clue recognition timed out. Retry a clearer picture." });
  h.c.tick(30000); p.hide(); h.c.tick(600000); p.show();
  h.c.tick(59999); await settle();
  assert.equal(h.workers[0].messages.some((m) => m.cancel === true), false);
  h.c.tick(1); await failed;
  assert.ok(h.workers[0].messages.some((m) => m.cancel === true), "the stuck host is told to stop");
});

// A cancelled job's recognition call gets 2 s to answer before the engine is
// replaced; a warm engine must not be thrown away for an app switch.
test("a cancelled OCR job's 2 s bound counts visible time: an app switch does not replace the engine", async (t) => {
  const p = page(), h = ocr(t, p), job = h.runtime.recognize({ png: "crop" });
  h.c.tick(500); h.runtime.cancel();
  await assert.rejects(job, { name: "AbortError" });
  h.c.tick(500); p.hide(); h.c.tick(60000); p.show();
  assert.equal(h.workers.length, 1); assert.notEqual(h.workers[0].terminated, true, "not replaced on return");
  h.c.tick(1499); assert.equal(h.workers[0].messages.some((m) => m.cancel === true), false);
  h.c.tick(1);
  assert.ok(h.workers[0].messages.some((m) => m.cancel === true), "a call stuck while visible is still stopped after 2 s");
});

test("loading OCR through an app switch does not time out on return", (t) => {
  const p = page(), h = ocr(t, p);
  h.runtime.prepare();
  h.c.tick(10000); p.hide(); h.c.tick(200000); p.show();
  h.c.tick(79999); assert.notEqual(h.workers[0].terminated, true);
  assert.equal(h.workers[0].messages.some((m) => m.cancel === true), false, "still loading, not timed out");
  h.reply({ type: "ready" }); h.c.tick(600000);
  assert.equal(h.workers[0].messages.some((m) => m.cancel === true), false);
});

test("image processing in flight through an app switch is not timed out on return", async (t) => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage() {} terminate() { this.terminated = true; } };
  t.after(() => { globalThis.Worker = previous; });
  const c = clock(t), p = page(), scanner = new Scanner();
  scanner.deadlines = visibleTimers({ now: c.now, page: p });
  t.after(() => scanner.cancel());
  let outcome = null;
  const pending = scanner.geometry("prepare", { image: { data: new Uint8ClampedArray(16), width: 2, height: 2 } });
  pending.then((r) => { outcome = r; }, (e) => { outcome = e; });
  c.tick(1000); p.hide(); c.tick(400000); p.show(); c.tick(1000); await settle();
  assert.equal(outcome, null);
  workers[0].onmessage({ data: { result: { rows: 9 } } }); await settle();
  assert.deepEqual(outcome, { rows: 9 });
  // A stuck one still times out after 180 s of visible time.
  const stuck = scanner.geometry("prepare", { image: { data: new Uint8ClampedArray(16), width: 2, height: 2 } });
  const failed = assert.rejects(stuck, { message: "Image processing timed out. Go online and retry." });
  c.tick(179999); p.hide(); c.tick(600000); p.show(); c.tick(1); await failed;
});
