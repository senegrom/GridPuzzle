import { createTrackingCore } from "../live-tracking-core.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveSolver } from "../live-solver.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness(t, solver = { solve: async () => null, cancel() {} }, initial = {}) {
  let time = 0, serial = 0, cancellations = 0, frozenTime = null;
  const timers = new Map(), detections = [], readings = [], nodes = new Map(), renders = [], texts = [];
  const previous = globalThis.document;
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText(text) { texts.push(text); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(180) }) };
  const canvas = () => ({ width: 700, height: 700, dataset: {}, attributes: {}, getContext: () => context, setAttribute(name, value) { this.attributes[name] = value; } });
  globalThis.document = { createElement: canvas };
  const view = canvas();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  // The help line is a polite live region: every write is announced.
  const writes = []; let helpText = "";
  nodes.set("camera-help", { get textContent() { return helpText; }, set textContent(value) { helpText = value; writes.push(value); } });
  const settings = { type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true, ...initial };
  let core = createTrackingCore(), hold = false, trackingError = false, rejectAll = false;
  const held = [];
  const tracker = {
    anchor: async task => { if (trackingError) throw Error('injected worker failure'); return core.run({ ...task, op: 'anchor' }); },
    // rejectAll: the worker answers, but no candidate's printed content matches.
    verify: task => rejectAll ? Promise.resolve({ proofs: Object.fromEntries(task.anchors.map(id => [id, null])),
      rejections: Object.fromEntries(task.anchors.map(id => [id, { reason: 'cell-content', region: 0 }])) }) :
      hold ? new Promise(resolve => held.push({ task, at: time, resolve, result: () => core.run({ ...task, op: 'verify' }) })) : Promise.resolve(core.run({ ...task, op: 'verify' })),
    reset() { core = createTrackingCore(); },
  };
  const camera = createLiveCamera({ tracker, $, diagnostics: { event() {}, configure() {}, geometry() {}, tracking() {}, scheduling() {}, rendering: v => renders.push(v) }, video: { videoWidth: 700, videoHeight: 700, get currentTime() { return frozenTime ?? time / 1000; } }, canvas: view,
    getSettings: () => ({ ...settings }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() { cancellations++; } },
    reader: { read() { const job = deferred(); readings.push(job); return job.promise; }, cancel() {} },
    solver, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; },
    clearTimer(id) { timers.delete(id); },
  });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; time = job.at; timers.delete(id); job.fn(); await flush();
    }
    time = end; await flush();
  }
  async function result(job = detections.at(-1), quality = undefined) {
    job.resolve({ confidence: .99, rows: 2, cols: 2, sharpness: 200, quality,
      corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
    await flush();
    await advance(100); // A detector reply cannot manufacture a new video frame.
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { get now() { return time; }, camera, timers, detections, readings, settings, advance, result, $, renders, view, texts, writes, failTracking(v) { trackingError=v; }, rejectVerify(v) { rejectAll = v; }, stall() { frozenTime = time / 1000; }, resume() { frozenTime = null; }, holdTracking(value) { hold = value; }, held, get cancellations() { return cancellations; } };
}

test("changing live settings immediately replaces a pending grid detection", async (t) => {
  const h = harness(t); await h.advance(100);
  assert.equal(h.detections.length, 1);
  const before = h.cancellations;
  h.settings.type = "sudoku"; await h.advance(100);
  assert.equal(h.detections.length, 2);
  assert.ok(h.cancellations > before);
  const text = h.$("camera-help").textContent;
  h.detections[0].reject(Error("obsolete detection")); await flush();
  assert.equal(h.$("camera-help").textContent, text);
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1, "the replacement detector must continue into OCR");
});

test("a stalled detector is bounded and retries without closing the camera", async (t) => {
  const h = harness(t); await h.advance(9000);
  assert.ok(h.detections.length >= 2, "grid detection must not stay locked indefinitely");
  h.detections[0].reject(Error("late timeout result")); await flush();
  assert.doesNotMatch(h.$("camera-help").textContent, /late timeout result/);
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
});

test("restarting the same camera object retires unfinished detection and resets its cadence", async (t) => {
  const h = harness(t); await h.advance(100); h.camera.stop();
  assert.equal(h.timers.size, 0);
  h.camera.start(); await h.advance(100);
  assert.equal(h.detections.length, 2);
  h.detections[0].resolve({ confidence: 0 }); await flush();
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
});

test("repeated starts do not create parallel preview timers", async (t) => {
  const h = harness(t); h.camera.start();
  assert.equal(h.timers.size, 1);
  h.camera.stop(); assert.equal(h.timers.size, 0);
});

test("retired detector cleanup cannot unlock another in-flight detection", async (t) => {
  const h = harness(t); await h.advance(100);
  h.settings.enabled = false; await h.advance(100);
  assert.equal(h.detections.length, 2);
  await h.result(h.detections[0]); await h.advance(1500);
  assert.equal(h.detections.length, 2, "obsolete completion must not clear the current detector's ownership");
});

test("a delayed error from an obsolete solver cannot cancel a replacement solve", async () => {
  const workers = [], timers = new Map(); let serial = 0;
  const solver = createLiveSolver({
    makeWorker() { const worker = { postMessage(m) { this.message = m; }, terminate() { this.terminated = true; } }; workers.push(worker); return worker; },
    setTimer(fn) { timers.set(++serial, fn); return serial; }, clearTimer(id) { timers.delete(id); },
  });
  const first = solver.solve({}), obsolete = workers[0].onerror;
  solver.cancel(); assert.equal(await first, null);
  const second = solver.solve({}); obsolete({ message: "old runtime failed" });
  assert.notEqual(workers[1].terminated, true);
  const result = { status: "unique", complete: true, solutions: [{ cells: [1] }] };
  workers[1].onmessage({ data: { type: "result", id: workers[1].message.id, result } });
  assert.equal(await second, result); assert.equal(timers.size, 0); solver.cancel();
});

test("starting the live camera warms the preview runtime once", async (t) => {
  let prepared = 0;
  const h = harness(t, { solve: async () => null, cancel() {}, prepare() { prepared++; } });
  assert.equal(prepared, 1);
  h.camera.start(); assert.equal(prepared, 1, "a repeated start must not warm again");
  h.camera.stop(); h.camera.start(); assert.equal(prepared, 2);
});

for (const type of ["latinsquare", "futoshiki", "numbrix", "hidato", "kenken", "kakuro", "slitherlink", "str8ts", "auto"])
  test(`${type}: invalid hidden box inputs do not block live recognition`, async t => {
    const h = harness(t);
    Object.assign(h.settings, { type, boxRows: 0, boxCols: NaN });
    await h.advance(100); await h.result(); await h.advance(700); await h.result();
    assert.equal(h.readings.length, 1);
    assert.doesNotMatch(h.$("camera-help").textContent, /does not fit/);
  });
for (const type of ["sudoku", "killersudoku"])
  test(`${type}: invalid live box settings still block recognition`, async t => {
    const h = harness(t);
    Object.assign(h.settings, { type, boxRows: 0, boxCols: NaN });
    await h.advance(100); await h.result(); await h.advance(700); await h.result();
    assert.equal(h.readings.length, 0);
    assert.match(h.$("camera-help").textContent, /does not fit/);
  });


test("digit-quality guidance blocks blurry clues despite a crisp global score, then recovers", async (t) => {
  const h = harness(t); await h.advance(100);
  await h.result(undefined, { assessable: true, score: 2, reason: "blur" });
  await h.advance(400); await h.result(undefined, { assessable: true, score: 2, reason: "blur" });
  assert.equal(h.readings.length, 0); assert.match(h.$("camera-help").textContent, /sharper numbers/);
  await h.advance(400); await h.result(undefined, { assessable: true, score: 150, reason: null });
  await h.advance(400); await h.result(undefined, { assessable: true, score: 150, reason: null });
  assert.equal(h.readings.length, 1, "read after genuinely clearer digits arrive");
});

test("small-number guidance preserves manual camera capture", async (t) => {
  const h = harness(t); await h.advance(100);
  await h.result(undefined, { assessable: false, reason: "small" });
  assert.match(h.$("camera-help").textContent, /too few pixels/);
  const capture = h.camera.capture(); assert.ok(capture.photo); assert.equal(capture.found, null);
});


test("a worker reply up to two seconds late is adopted as a delayed overlay", async t => {
 const h=harness(t);await h.advance(100);await h.result();
 assert.equal(h.camera.diagnosticSource().verified,true);assert.equal(h.view.dataset.delayed,"0");
 assert.equal(h.texts.includes("DELAYED"),false,'a prompt worker draws a live overlay');
 h.holdTracking(true);await h.advance(900);
 assert.equal(h.camera.diagnosticSource().verified,true,'a verified view survives a slow worker inside the stale limit');
 assert.equal(h.view.dataset.delayed,"1");assert.ok(h.texts.includes("DELAYED"));
 assert.match(h.view.attributes["aria-label"],/delayed/);
 const early=h.held[0];assert.ok(early,'a verify submitted while the worker was slow');
 early.resolve(early.result());await flush();
 assert.equal(h.camera.diagnosticSource().verified,true,'a reply inside the limit is adopted');
 assert.equal(h.view.dataset.delayed,"1",'its snapshot is older than the live tier');
 h.holdTracking(false);await h.advance(300);
 assert.equal(h.view.dataset.delayed,"1",'one prompt reply does not end the delayed tier');
 await h.advance(2000);
 assert.equal(h.view.dataset.delayed,"0",'two seconds of prompt replies return the view to the live tier');
 h.camera.stop();
 for(const job of h.held)job.resolve({proofs:{}});
 await flush();assert.equal(h.camera.diagnosticSource().verified,false,'closing still rejects every queued reply');
});
test("a worker reply older than the stale limit is dropped and the view falls back unverified", async t => {
 const h=harness(t);await h.advance(100);await h.result();
 h.holdTracking(true);await h.advance(2300);
 assert.equal(h.camera.diagnosticSource().verified,false,'past the stale limit the display is an unverified fresh frame');
 assert.equal(h.view.dataset.delayed,"0");assert.equal(h.camera.capture().found,null);
 const late=h.held[0];assert.ok(h.now-late.at>2000);late.resolve(late.result());await flush();
 assert.equal(h.camera.diagnosticSource().verified,false,'a reply older than the stale limit cannot restore the view');
 const recent=h.held.at(-1);assert.notEqual(recent,late);recent.resolve(recent.result());await flush();
 assert.equal(h.camera.diagnosticSource().verified,true,'a reply submitted after the fallback recovers tracking');
});
test("after a fallback, a reply still within the stale limit is adopted on its own snapshot", async t => {
 const h=harness(t);await h.advance(100);await h.result();
 h.holdTracking(true);await h.advance(2300);
 assert.equal(h.camera.diagnosticSource().verified,false,'the display fell back to an unverified frame');
 // Submitted before the fallback, but its own snapshot is 1.3 s old.
 const inFlight=h.held.find(job=>job.at>=1200);assert.ok(h.now-inFlight.at<=1300);
 inFlight.resolve(inFlight.result());await flush();
 assert.equal(h.camera.diagnosticSource().verified,true,'a reply within the stale limit is not fenced out by the fallback');
 assert.equal(h.view.dataset.delayed,"1",'its snapshot is drawn as delayed');
 const paints=h.renders.filter(r=>r.painted).length;
 const older=h.held.find(job=>job.at<inFlight.at&&h.now-job.at<=2000);
 older.resolve(older.result());await flush();
 assert.equal(h.renders.filter(r=>r.painted).length,paints,'an older reply never replaces a newer adopted snapshot');
 assert.equal(h.camera.diagnosticSource().verified,true);
});
test("crossing into the delayed tier repaints once without a new frame", async t => {
 const h=harness(t);await h.advance(100);await h.result();
 h.holdTracking(true);
 const before=h.renders.length;await h.advance(300);
 assert.ok(h.renders.length>before);
 assert.ok(h.renders.slice(before).every(r=>!r.painted),'an unchanged live view is not repainted');
 const mid=h.renders.length;await h.advance(300);
 assert.ok(h.renders.slice(mid).some(r=>r.painted),'entering the delayed tier repaints');
 assert.equal(h.view.dataset.delayed,"1");
});
test("capturing in the delayed tier keeps the verified frame and its reading", async t => {
 const h=harness(t);await h.advance(100);await h.result();await h.advance(400);await h.result();
 assert.equal(h.readings.length,1);
 const {makePuzzle}=await import('../model.js');const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,null,null,1];
 h.readings[0].resolve({puzzle,cellUncertain:[],uncertain:[],markedCells:[0,3],needsReview:true,notes:[]});await flush();
 assert.ok(h.camera.capture().found);
 h.holdTracking(true);await h.advance(900);
 assert.equal(h.view.dataset.delayed,"1");
 const capture=h.camera.capture();
 assert.ok(capture.found,'a delayed but verified view still carries its reading');assert.ok(capture.corners);assert.ok(capture.photo);
 assert.equal(h.camera.diagnosticSource().verified,true);
});


test("stalled video loses overlays on the heartbeat without a new processing tick", async t => {
 const h=harness(t);await h.advance(100);await h.result();await h.advance(400);await h.result();
 assert.equal(h.readings.length,1);
 const {makePuzzle}=await import('../model.js');const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,null,null,1];
 h.readings[0].resolve({puzzle,cellUncertain:[],uncertain:[],markedCells:[0,3],needsReview:true,notes:[]});await flush();
 assert.ok(h.camera.capture().found);
 h.stall();const detections=h.detections.length;await h.advance(600);
 assert.equal(h.camera.capture().found,null);assert.equal(h.camera.diagnosticSource().verified,false);
 assert.equal(h.detections.length,detections,'heartbeat must not detect again from old video pixels');
 assert.match(h.$('camera-help').textContent,/new camera frame/);
 h.resume();await h.advance(100);assert.ok(h.camera.capture().found,'unchanged source can be reverified');
 assert.equal(h.readings.length,1,'brief stalled delivery does not destroy OCR');
 assert.doesNotMatch(h.$('camera-help').textContent,/new camera frame/,'the stall message gives way to the status once frames resume');
});

test("heartbeats do not rewrite an unchanged help line", async t => {
 const h=harness(t);await h.advance(100);await h.result();await h.advance(400);await h.result();
 assert.equal(h.readings.length,1);assert.match(h.$('camera-help').textContent,/Reading printed clues/);
 const before=h.writes.length;await h.advance(5000);
 assert.deepEqual(h.writes.slice(before),[],'fifty heartbeats with nothing held must not re-announce the status');
 h.stall();await h.advance(600);assert.match(h.$('camera-help').textContent,/new camera frame/);
 const held=h.writes.length;await h.advance(1000);
 assert.equal(h.writes.length,held,'a held message is written once, not on every heartbeat');
 h.resume();await h.advance(300);
 assert.match(h.$('camera-help').textContent,/Reading printed clues/,'releasing the hold shows the status again');
});

test("a detector finishing on a stalled feed cannot manufacture fresh evidence", async t => {
 const h=harness(t);await h.advance(100);h.stall();await h.advance(600);await h.result();
 assert.equal(h.readings.length,0);assert.equal(h.camera.diagnosticSource().verified,false);
 assert.equal(h.camera.capture().found,null);
});

test('auto-solve off never prewarms the live solver; enabling warms it once',async t=>{
 let count=0;const h=harness(t,{prepare(){count++;},cancel(){},solve:async()=>null},{autoSolve:false});
 await h.advance(100);assert.equal(count,0);h.settings.autoSolve=true;await h.advance(100);assert.equal(count,1);
 await h.advance(200);assert.equal(count,1);h.settings.autoSolve=false;await h.advance(100);assert.equal(count,1);
});
test('unchanged heartbeat and pre-tracking views skip redundant paints without skipping validation',async t=>{
 const h=harness(t);await h.advance(100);await h.result();await h.advance(400);await h.result();
 const {makePuzzle}=await import('../model.js');const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,null,null,1];
 h.readings[0].resolve({puzzle,cellUncertain:[],uncertain:[],markedCells:[0,3],needsReview:true,notes:[]});await flush();
 await h.advance(1000);assert.ok(h.renders.some(r=>!r.painted));assert.ok(h.camera.capture().found);
 h.stall();await h.advance(600);assert.equal(h.camera.capture().found,null);
});
test('the rejected-alignment message gives way when the detector stops finding a matching grid',async t=>{
 const h=harness(t);h.rejectVerify(true);await h.advance(100);
 for(let k=0;k<3;k++){await h.result();await h.advance(700);}
 assert.match(h.$('camera-help').textContent,/not matching between frames/);assert.equal(h.$('restart-live').hidden,false);
 for(let k=0;k<3;k++){h.detections.at(-1).resolve({confidence:0});await flush();await h.advance(700);}
 assert.equal(h.$('camera-help').textContent,'Keep the whole grid in view, in even light.','no-grid guidance must not be overwritten by an old rejection streak');
 assert.equal(h.$('restart-live').hidden,true);
 for(let k=0;k<2;k++){await h.result();await h.advance(700);}
 assert.doesNotMatch(h.$('camera-help').textContent,/not matching between frames/,'a new streak starts from zero');
 await h.result();await h.advance(700);
 assert.match(h.$('camera-help').textContent,/not matching between frames/);
 h.detections.at(-1).resolve({confidence:.99,rows:3,cols:2,sharpness:200,corners:[{x:0,y:0},{x:639,y:0},{x:639,y:639},{x:0,y:639}]});
 await flush();await h.advance(700);
 assert.match(h.$('camera-help').textContent,/does not fit/,'a grid that contradicts the rules is reported, not hidden behind the streak');
});
test('repeated tracking failures back off and stop until an explicit restart',async t=>{
 const h=harness(t);h.failTracking(true);await h.advance(100);await h.result();
 assert.equal(h.camera.stats.recovery.failures,1);await h.advance(1500);assert.equal(h.detections.length,1);
 await h.advance(1000);await h.result();assert.equal(h.camera.stats.recovery.failures,2);
 await h.advance(4500);await h.result();assert.equal(h.camera.stats.recovery.blocked,true);
 const count=h.detections.length;await h.advance(15000);assert.equal(h.detections.length,count);
 assert.equal(h.$('restart-live').hidden,false);assert.ok(h.camera.capture().photo);
 h.failTracking(false);h.camera.restart();await h.advance(100);await h.result();await h.advance(500);await h.result();
 assert.equal(h.camera.stats.recovery.blocked,false);assert.equal(h.readings.length,1);
});
test('thirty open/close cycles release source/scratch canvases and timers, including late detectors',async t=>{
 const h=harness(t);
 for(let i=0;i<30;i++){
  h.camera.start();await h.advance(100);const old=h.detections.at(-1);h.camera.stop();
  assert.equal(h.timers.size,0);assert.equal(h.camera.stats.scratchPixels,0);assert.equal(h.camera.stats.retainedSources,0);
  await h.result(old);assert.equal(h.camera.stats.active,false);assert.equal(h.timers.size,0);
 }
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

// --- live-camera: a detected grid that contradicts the chosen rules --------
test("a detected grid that does not fit the selected rules shows the reason instead of failing every frame", async (t) => {
  const timers = new Map(); let serial = 0, time = 0;
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(180) }) };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} }) };
  t.after(() => { globalThis.document = previous; });
  const detections = [], invalidations = [];
  const camera = createLiveCamera({ $, video: { videoWidth: 700, videoHeight: 700, get currentTime() { return time / 1000; } }, canvas: { width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} },
    getSettings: () => ({ type: "sudoku", rows: 9, cols: 9, boxRows: 3, boxCols: 3, enabled: true }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() {} },
    reader: { read() { return new Promise(() => {}); }, cancel() {} },
    solver: { solve: async () => null, cancel() { invalidations.push("cancel"); }, prepare() {} }, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; }, clearTimer(id) { timers.delete(id); } });
  const advance = async (ms) => { const end = time + ms; for (;;) { const next = [...timers.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); await tick(); } time = end; await tick(); };
  t.after(() => camera.stop());
  camera.start(); await advance(100);
  assert.equal(detections.length, 1);
  detections[0].resolve({ confidence: .99, rows: 9, cols: 6, sharpness: 200, corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
  await tick();
  assert.match($("camera-help").textContent, /Detected 9 × 6, which does not fit Sudoku/);
  await advance(300);
  assert.match($("camera-help").textContent, /does not fit Sudoku/, "the message survives further frames instead of a per-tick error");
});
