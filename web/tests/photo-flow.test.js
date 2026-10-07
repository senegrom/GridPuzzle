import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { MAX_REVIEW_NOTES, MAX_REVIEW_NOTE_LENGTH, restoreSession, saveSession } from "../session.js";
import { boxShape, fitPlay, makePuzzle } from "../model.js";
import { createBackup, parsePuzzleFile, puzzleDefinition } from "../backup.js";
import { puzzleFromReadings } from "../scanner.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";
import { retainPhotoSource } from "../photo-detail.js";
import { createFrameScheduler } from "../live-frame-scheduler.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function photoImports(t) {
  const nodes = new Map(), queue = [], errors = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: false });
    return nodes.get(id);
  };
  const originals = ["document", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.document = { addEventListener() {} };
  globalThis.Image = class {
    decode() {
      const next = queue.shift();
      next.started.resolve();
      return next.decode.promise;
    }
  };
  let epoch = 0;
  const stopTask = () => { epoch++; };
  setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask,
    getJobId: () => epoch,
    fail: (error) => errors.push(error.message),
  });
  return {
    errors, stopTask,
    async choose(id = "photo-file", wait = true) {
      const request = { started: deferred(), decode: deferred() };
      queue.push(request);
      const input = { files: [new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,16,8,2,0,0,0,0,0,0,0,0,0,0,0,73,69,78,68,0,0,0,0])])], value: "photo" };
      const completed = $(id).onchange({ target: input });
      if (wait) await request.started.promise;
      return { completed, started: request.started.promise, reject: request.decode.reject, input };
    },
  };
}
test("active photo decode failures still report an error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  first.reject(Error("Image cannot be decoded"));
  await first.completed;
  assert.deepEqual(imports.errors, ["Image cannot be decoded"]);
  assert.equal(first.input.value, "");
});
test("cancelling a photo decode suppresses its delayed error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  imports.stopTask();
  first.reject(Error("Obsolete photo error"));
  await first.completed;
  assert.deepEqual(imports.errors, []);
});
test("an older native-photo failure cannot replace a newer import error", async (t) => {
  const imports = photoImports(t), first = await imports.choose("native-file"), second = await imports.choose("photo-file", false);
  first.reject(Error("Obsolete camera photo error"));
  await first.completed;
  await second.started;
  second.reject(Error("Current photo error"));
  await second.completed;
  assert.deepEqual(imports.errors, ["Current photo error"]);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

// --- photo-flow: captured still, track listeners, Escape -----------------
// The page with a fake live camera: `h.live.freeze()` does what the camera
// does when it freezes a solved view, and its resume() what Clear asks of it.
// getUserMedia hands out the same stream again, or a new one per call with
// `freshStreams`. `video` replaces the plain #video node with a model whose
// own play() and pause() run (counted all the same), and `makeLive(options)`
// builds the live camera instead of the fake. `h.diagnostics` is the page's
// own, as handed to the live camera.
async function cameraHarness(t, { capture = null, play = async () => {}, freshStreams = false, video = null, makeLive = null } = {}) {
  const { setupPhotoFlow } = await import("../photo-flow.js");
  const nodes = new Map(), statuses = [], listeners = {}, tracks = [], lives = [], saved = [];
  let flow = null, diagnostics = null, liveOptions = null;
  t.after(() => flow?.stopCamera()); // Before the globals go: it clears the page's timers.
  // A node's 2D context records what is drawn into it.
  const $ = (id) => {
    if (!nodes.has(id)) {
      const context = { draws: [], clearRect() {}, drawImage(source) { this.draws.push(source); } };
      nodes.set(id, { hidden: true, disabled: false, textContent: "", style: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { this.focused = (this.focused || 0) + 1; }, getContext: () => context });
    }
    return nodes.get(id);
  };
  for (const key of ["navigator", "document"]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const handlers = new Map();
  globalThis.document = { hidden: false, body: { classList: { add() {}, remove() {} } },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      listeners[type] = event => { for (const cb of [...handlers.get(type)]) cb(event); };
    },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
  };
  // `track.events[type]()` dispatches to every listener of that type, as an
  // EventTarget does, dropping the `once` ones.
  const makeStream = () => {
    const listeners = {};
    const track = { stopped: 0, events: {}, enabled: true, readyState: "live", muted: false,
      stop() { this.stopped++; this.readyState = "ended"; },
      addEventListener(type, fn, options) {
        (listeners[type] ??= []).push({ fn, once: options?.once === true });
        this.events[type] = () => {
          const all = listeners[type];
          listeners[type] = all.filter((entry) => !entry.once);
          for (const entry of all) entry.fn();
        };
      } };
    tracks.push(track);
    const own = [track];
    return { getTracks: () => own };
  };
  const stream = makeStream();
  let requests = 0, refusal = null, playback = play, plays = 0, pauses = 0, gate = null;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    requests++;
    if (gate) await gate.promise;
    if (refusal) throw refusal;
    return freshStreams && requests > 1 ? makeStream() : stream;
  } } } });
  if (video) nodes.set("video", video);
  // Each play() records the stream attached when it was called.
  const node = $("video"), ownPlay = video?.play.bind(video), ownPause = video?.pause.bind(video), playedOn = [];
  node.play = (...args) => { plays++; playedOn.push(node.srcObject); return ownPlay ? ownPlay(...args) : playback(...args); };
  node.pause = () => { pauses++; ownPause?.(); };
  let liveStarted = 0, liveStopped = 0;
  flow = setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask() {}, status: (...args) => statuses.push(args),
    savePicture: async (annotated, createdAt) => { saved.push({ annotated, createdAt }); return true; },
    liveFactory: (options) => {
      diagnostics = options.diagnostics; liveOptions = options;
      const live = makeLive ? makeLive(options) : { view: "live", resumed: 0, stats: { scheduling: { observed: 0 } },
        start() { liveStarted++; }, stop() { liveStopped++; }, capture: () => capture,
        resume() { if (this.view !== "frozen") return; this.view = "live"; this.resumed++; options.onViewChange?.("live"); },
        freeze() { this.view = "frozen"; options.onViewChange?.("frozen"); } };
      lives.push(live);
      return live;
    },
  });
  return { $, flow, statuses, listeners, track: tracks[0], tracks, saved, stream, playedOn,
    get live() { return lives.at(-1); }, get diagnostics() { return diagnostics; }, get liveOptions() { return liveOptions; },
    get liveStarted() { return liveStarted; }, get liveStopped() { return liveStopped; },
    get requests() { return requests; }, refuse(error) { refusal = error; },
    holdRequests() { gate = deferred(); return gate; },
    get plays() { return plays; }, get pauses() { return pauses; }, setPlay(fn) { playback = fn; },
    hide() { globalThis.document.hidden = true; listeners.visibilitychange(); globalThis.document.hidden = false; } };
}
// Timers the test runs by hand, from here on.
function manualTimers(t) {
  const timers = new Map(), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
  let next = 0;
  t.after(() => { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; });
  globalThis.setTimeout = (fn, ms) => { timers.set(++next, { fn, ms }); return next; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  return timers;
}

const stillPicture = () => ({ photo: {}, annotated: {}, found: null, corners: null, createdAt: 1 });

test("hiding the page keeps a captured still on screen but releases a live camera", async (t) => {
  const h = await cameraHarness(t, { capture: stillPicture() });
  await h.$("camera").onclick();
  assert.equal(h.liveStarted, 1);
  await h.$("take-photo").onclick();
  await tick();
  assert.equal(h.$("camera-panel").hidden, false);
  assert.equal(h.track.stopped, 1, "the shutter releases the camera");
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, false, "a still holds no camera and must survive an app switch");
  assert.equal(h.$("use-live-capture").hidden, false);
  globalThis.document.hidden = false;
  await h.$("retake-photo").onclick();
  assert.equal(h.liveStarted, 2);
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, true, "a live camera is released when the page is hidden");
  assert.equal(h.track.stopped, 2);
});

test("track-ended listeners are attached before playback is awaited", async (t) => {
  const playback = deferred();
  const h = await cameraHarness(t, { play: () => playback.promise });
  const opening = h.$("camera").onclick();
  await tick(); await tick();
  assert.equal(typeof h.track.events.ended, "function", "a stream that dies during play() must still close the panel");
  h.track.events.ended();
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera disconnected/);
  playback.resolve();
  await opening;
  assert.equal(h.liveStarted, 0, "playback resolving after the stream ended must not start a preview");
});

test("Escape closes the full-screen camera and returns focus to its opener", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  assert.equal(h.$("close-camera").focused, 1, "focus moves into the panel when it opens");
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera closed/);
  assert.equal(h.$("camera").focused, 1);
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera").focused, 1, "Escape with the panel closed is not ours");
});

// "Wait up to 3 s for clearer clues before freezing" (#freeze-wait): the
// camera reads the box at each call, so a change applies to the reading on
// screen, off unless ticked; the diagnostics record it with the live scan's
// settings, as they record automatic solving.
test("the live camera takes the freeze's wait from its checkbox, off unless ticked", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  const settings = h.liveOptions.getSettings;
  assert.equal(settings().freezeWait, false, "an unticked box");
  assert.equal(h.diagnostics.snapshot().settings.freezeWait, false, "recorded with the scan's settings");
  h.$("freeze-wait").checked = true;
  assert.equal(settings().freezeWait, true, "read at each call");
  h.$("freeze-wait").checked = false;
  assert.equal(settings().freezeWait, false);
});
test("a camera opened with the freeze's wait ticked records it in the diagnostics", async (t) => {
  const h = await cameraHarness(t);
  h.$("freeze-wait").checked = true; h.$("auto-solve").checked = true;
  await h.$("camera").onclick();
  assert.equal(h.liveOptions.getSettings().freezeWait, true);
  const { settings } = h.diagnostics.snapshot();
  assert.equal(settings.freezeWait, true); assert.equal(settings.autoSolve, true);
});

// --- photo-flow: the frozen solution and Clear --------------------------
test("freezing pauses the video but keeps the camera on; Clear plays it again before scanning resumes", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  assert.equal(h.$("camera-panel").attributes["data-view"], "live");
  assert.equal(h.$("clear-freeze").hidden, true);
  const plays = h.plays, live = h.live;
  live.freeze();
  assert.equal(h.$("camera-panel").attributes["data-view"], "frozen");
  assert.equal(h.$("clear-freeze").hidden, false); assert.equal(h.$("view-state").hidden, false);
  assert.equal(h.pauses, 1, "the video element stops behind the still");
  assert.equal(h.$("video").srcObject, h.stream, "and keeps the stream attached, ready to play again");
  assert.equal(h.plays, plays, "marking a view never plays");
  assert.equal(h.track.enabled, true); assert.equal(h.track.stopped, 0, "the camera itself stays on");
  const playback = deferred();
  h.setPlay(() => playback.promise);
  const clearing = h.$("clear-freeze").onclick();
  assert.equal(h.plays, plays + 1, "Clear plays inside its tap");
  assert.equal(h.playedOn.at(-1), h.stream, "on the stream that stayed attached");
  await tick();
  assert.equal(live.resumed, 0, "the still stays until playback has resumed");
  assert.equal(h.$("clear-freeze").disabled, true);
  assert.equal(h.$("clear-freeze").onclick(), undefined, "a second tap meanwhile does nothing");
  playback.resolve(); await clearing;
  assert.equal(live.resumed, 1); assert.equal(live.view, "live");
  assert.equal(h.requests, 1, "a stream that stayed on needs no new getUserMedia");
  assert.equal(h.$("take-photo").focused, 1, "focus returns to the shutter");
  assert.equal(h.$("camera-panel").attributes["data-view"], "live");
  assert.equal(h.$("clear-freeze").hidden, true); assert.equal(h.$("view-state").hidden, true);
  assert.equal(h.$("clear-freeze").disabled, false);
  assert.equal(h.liveStopped, 0);
});

test("freezing starts no timer: the camera is not turned off while frozen", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  const timers = manualTimers(t);
  h.live.freeze();
  assert.equal(timers.size, 0, "nothing releases the stream later");
  assert.equal(h.track.enabled, true); assert.equal(h.track.stopped, 0);
  await h.$("clear-freeze").onclick();
  assert.equal(h.requests, 1, "Clear plays the stream that stayed on");
  assert.equal(h.live.resumed, 1);
});

// A <video> after WebKit's MediaStream player. Assigning srcObject makes a
// new player, which has no picture until its first camera frame. Every frame
// counts as presented, but a paused player keeps the picture it had for
// drawing, and play() does not refresh it before the next frame
// (MediaPlayerPrivateMediaStreamAVFObjC.mm:319-331, 615-643, 1155-1162).
// A video-frame callback runs at a rendering update once the player has a
// picture and its count moved since the last callback, paused or not
// (HTMLVideoElement.cpp:887-935; MediaPlayerPrivateMediaStreamAVFObjC.mm:1271-1291).
// The camera produces frames whether the element is attached or not.
function webkitVideo() {
  let player = null, paused = true, request = null;
  const waiting = [], abort = (message) => {
    for (const job of waiting.splice(0)) job.reject(Object.assign(Error(message), { name: "AbortError" }));
  };
  const video = {
    frame: 0, ended: false,
    get srcObject() { return player?.stream ?? null; },
    loads: 0,
    set srcObject(stream) {
      video.loads++;
      abort("The play() request was interrupted by a new load request.");
      if (player) paused = true; // The load algorithm pauses an element that had a source.
      player = stream ? { stream, count: 0, serviced: 0, picture: null } : null;
    },
    get paused() { return paused; },
    get readyState() { return player?.picture ? 4 : 0; },
    get videoWidth() { return player?.picture ? 640 : 0; },
    get videoHeight() { return player?.picture ? 480 : 0; },
    // What drawImage(video) would draw.
    get picture() { return player?.picture ?? null; },
    play() {
      paused = false;
      return player?.picture ? Promise.resolve() : new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    pause() { paused = true; abort("The play() request was interrupted by a call to pause()."); },
    load() {},
    requestVideoFrameCallback(callback) { request = callback; return 1; },
    cancelVideoFrameCallback() { request = null; },
    cameraFrame() {
      video.frame++;
      if (!player) return;
      player.count++;
      if (!player.picture || !paused) player.picture = video.frame;
      if (!paused) for (const job of waiting.splice(0)) job.resolve();
    },
    renderingUpdate() {
      if (!request || !player?.picture || player.count === player.serviced) return;
      player.serviced = player.count;
      const callback = request; request = null;
      callback(0, { presentedFrames: player.count });
    },
  };
  return video;
}
// The live camera reduced to its frame scheduler: start, the freeze and Clear
// start and stop the real scheduler on the video as live-camera.js does (Clear
// with discardFirst), and each frame it hands on records the picture a
// snapshot would draw.
function schedulerLive(options, drawn) {
  let time = 0;
  const scheduler = createFrameScheduler({ video: options.video, onFrame: () => drawn.push(options.video.picture),
    now: () => (time += 150), setTimer: () => 0, clearTimer() {} });
  return { view: "live", resumed: 0, get stats() { return { scheduling: scheduler.stats }; },
    start() { scheduler.start(); }, stop() { scheduler.stop(); }, capture: () => null,
    resume() { if (this.view !== "frozen") return; this.view = "live"; this.resumed++; scheduler.start({ discardFirst: true }); options.onViewChange?.("live"); },
    freeze() { this.view = "frozen"; scheduler.stop(); options.onViewChange?.("frozen"); } };
}

test("after Clear the camera scans a frame presented after the tap, never the frame of the freeze", async (t) => {
  const video = webkitVideo(), drawn = [];
  const h = await cameraHarness(t, { video, makeLive: (options) => schedulerLive(options, drawn) });
  const opening = h.$("camera").onclick();
  await tick(); await tick();
  video.cameraFrame(); await opening; // The first frame lets play() resolve.
  video.cameraFrame(); video.renderingUpdate();
  assert.deepEqual(drawn, [2]);
  h.live.freeze();
  assert.equal(video.srcObject, h.stream, "the stream stays attached"); assert.equal(video.paused, true);
  assert.equal(h.track.enabled, true); assert.equal(h.track.stopped, 0, "the camera stays on");
  for (let i = 0; i < 5; i++) { video.cameraFrame(); video.renderingUpdate(); }
  assert.deepEqual(drawn, [2], "nothing is scanned while frozen");
  const tapped = video.frame, plays = h.plays, loads = video.loads, clearing = h.$("clear-freeze").onclick();
  assert.equal(h.plays, plays + 1, "play() runs inside the tap");
  assert.equal(h.playedOn.at(-1), h.stream, "on the stream that stayed attached");
  // Assigning the same stream again makes a new player, which WebKit (CI's
  // WebKitGTK) left without a frame, so that Clear timed out.
  assert.equal(video.loads, loads, "Clear loads nothing: it plays the player that stayed attached");
  await tick(); await tick();
  video.renderingUpdate(); // A rendering update before the camera's next frame.
  video.cameraFrame(); await tick(); await tick();
  video.renderingUpdate();
  await clearing;
  assert.equal(h.live.view, "live");
  assert.ok(drawn[1] > tapped, `the first frame scanned after Clear is ${drawn[1]}: the tap came after frame ${tapped}, the freeze at frame 2`);
  assert.equal(h.requests, 1, "no getUserMedia: the camera stayed on");
});

test("Clear whose playback is refused offers Start preview, which plays again and then resumes", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  h.setPlay(async () => { throw Object.assign(Error("Playback needs a tap"), { name: "NotAllowedError" }); });
  await h.$("clear-freeze").onclick();
  assert.equal(h.live.view, "frozen", "the solution stays on screen");
  assert.equal(h.$("start-camera").hidden, false); assert.match(h.$("camera-help").textContent, /Start preview/);
  assert.equal(h.$("clear-freeze").hidden, false); assert.equal(h.$("clear-freeze").disabled, false);
  h.setPlay(async () => {});
  const plays = h.plays;
  await h.$("start-camera").onclick();
  assert.equal(h.plays, plays + 1);
  assert.equal(h.live.resumed, 1); assert.equal(h.live.view, "live");
  assert.equal(h.$("start-camera").hidden, true);
});

test("Clear whose playback never starts offers Start preview after eight seconds and keeps the frozen view", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  const timers = manualTimers(t);
  h.setPlay(() => new Promise(() => {}));
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [8000], "the one playback timer");
  [...timers.values()][0].fn(); await clearing;
  assert.equal(timers.size, 0);
  assert.equal(h.$("start-camera").hidden, false);
  assert.match(h.$("camera-help").textContent, /No camera frame arrived/);
  assert.equal(h.live.view, "frozen"); assert.equal(h.$("camera-panel").hidden, false);
  assert.equal(h.live.resumed, 0);
});

test("closing the camera while Clear waits for playback fences the Clear", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  const live = h.live, playback = deferred();
  h.setPlay(() => playback.promise);
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  const help = h.$("camera-help").textContent;
  playback.resolve(); await clearing;
  assert.equal(live.resumed, 0, "a closed camera is not resumed");
  assert.equal(h.$("camera-panel").hidden, true);
  assert.equal(h.$("camera-help").textContent, help);
  assert.equal(h.$("clear-freeze").disabled, false, "the next frozen view can be cleared");
});

test("hiding the page while Clear waits for playback keeps the frozen solution", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  const playback = deferred();
  h.setPlay(() => playback.promise);
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  h.hide();
  playback.resolve(); await clearing;
  assert.equal(h.live.resumed, 0, "a camera turned off meanwhile is not resumed");
  assert.equal(h.live.view, "frozen");
  assert.match(h.$("camera-help").textContent, /turned off while the app was in the background/);
  assert.equal(h.$("clear-freeze").disabled, false);
  h.setPlay(async () => {});
  await h.$("clear-freeze").onclick();
  assert.equal(h.requests, 2); assert.equal(h.live.resumed, 1);
});

// Browsers reject a pending play() with an AbortError once its stream is
// detached, as the camera-off does.
test("a Clear whose playback the camera-off interrupts keeps the camera-off line", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick();
  h.live.freeze();
  const playback = deferred();
  h.setPlay(() => playback.promise); // play() is still pending when the app is hidden.
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  h.hide();
  playback.reject(Object.assign(Error("The play() request was interrupted by a new load request."), { name: "AbortError" }));
  await clearing;
  assert.match(h.$("camera-help").textContent, /turned off while the app was in the background/);
  assert.equal(h.$("start-camera").hidden, true, "no retry for a camera that was turned off");
  assert.equal(h.live.view, "frozen"); assert.equal(h.live.resumed, 0);
  assert.equal(h.$("clear-freeze").disabled, false);
});

test("hiding the page while frozen turns the camera off but keeps the solution; Clear asks for the camera again", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.hide();
  assert.equal(h.track.stopped, 1, "the camera is turned off");
  assert.equal(h.$("video").srcObject, null);
  assert.equal(h.$("camera-panel").hidden, false); assert.equal(h.liveStopped, 0);
  assert.equal(h.live.view, "frozen"); assert.equal(h.$("clear-freeze").hidden, false);
  assert.match(h.$("camera-help").textContent, /turned off while the app was in the background/);
  assert.match(h.$("camera-help").textContent, /Clear turns it back on, and the phone may ask for camera access again\.$/);
  h.hide();
  assert.equal(h.track.stopped, 1, "a released camera is not released twice");
  const plays = h.plays, clearing = h.$("clear-freeze").onclick();
  // Synchronously, so that a browser that prompts again sees the tap's gesture.
  assert.equal(h.requests, 2, "Clear asks for the camera inside its tap, before it awaits anything");
  await clearing;
  assert.equal(h.$("video").srcObject.getTracks()[0], h.tracks[1]);
  assert.equal(h.plays, plays + 1); assert.equal(h.live.resumed, 1);
  assert.equal(typeof h.tracks[1].events.ended, "function", "the new track is watched too");
});

test("Save picture keeps the frozen solution after the camera was turned off", async (t) => {
  const frozen = { photo: {}, annotated: { frozen: true }, found: null, corners: null, createdAt: 5, frozen: true };
  const h = await cameraHarness(t, { capture: frozen });
  await h.$("camera").onclick(); h.live.freeze();
  h.hide();
  await h.$("take-photo").onclick(); await tick();
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].annotated, frozen.annotated);
  assert.equal(h.$("camera-panel").attributes["data-view"], "captured");
  assert.equal(h.$("clear-freeze").hidden, true); assert.equal(h.$("view-state").hidden, true);
  assert.equal(h.$("use-live-capture").hidden, false); assert.equal(h.liveStopped, 1);
});

test("a camera granted after the app was hidden again is turned off, and the frozen view stays", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze(); h.hide();
  const request = h.holdRequests();
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  assert.match(h.$("camera-help").textContent, /Turning the camera back on/);
  globalThis.document.hidden = true; h.listeners.visibilitychange();
  request.resolve(); await clearing;
  globalThis.document.hidden = false;
  assert.equal(h.tracks[1].stopped, 1, "the late stream is stopped at once");
  assert.equal(h.live.view, "frozen"); assert.equal(h.live.resumed, 0);
  assert.match(h.$("camera-help").textContent, /turned off while the app was in the background/);
  assert.equal(h.$("clear-freeze").disabled, false);
});

test("a camera granted after the panel was closed is turned off and touches nothing", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze(); h.hide();
  // A permission prompt, or the camera's start-up, outlasts the panel.
  const request = h.holdRequests();
  const clearing = h.$("clear-freeze").onclick();
  await tick();
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  const help = h.$("camera-help").textContent;
  request.resolve(); await clearing;
  assert.equal(h.tracks[1].stopped, 1, "the stream granted after the close is stopped at once");
  assert.equal(h.$("video").srcObject, null, "and never attached");
  assert.equal(h.$("camera-help").textContent, help, "the closed panel's line is left alone");
  assert.equal(h.$("camera-panel").hidden, true);
});

test("an old Clear that fails after the camera was reopened and froze again leaves the new view alone", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze(); h.hide();
  const old = h.holdRequests();
  const oldClear = h.$("clear-freeze").onclick();
  await tick();
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  const fresh = h.holdRequests(); // The reopened camera's own request.
  const reopening = h.$("camera").onclick();
  fresh.resolve(); await reopening;
  const live = h.live;
  assert.equal(h.liveStarted, 2);
  live.freeze();
  h.setPlay(() => new Promise(() => {})); // The new Clear's playback is still pending.
  void h.$("clear-freeze").onclick();
  await tick();
  assert.equal(h.$("clear-freeze").disabled, true);
  const help = h.$("camera-help").textContent;
  h.refuse(Object.assign(Error("Permission denied"), { name: "NotAllowedError" }));
  old.resolve(); await oldClear;
  assert.equal(h.$("camera-help").textContent, help, "the old Clear writes nothing into the new view");
  assert.equal(h.$("start-camera").hidden, true, "and offers no retry there");
  assert.equal(h.$("clear-freeze").disabled, true, "nor re-enables the new Clear while it waits");
  assert.equal(live.view, "frozen");
});

test("a refused camera on Clear keeps the frozen view, says why and leaves Clear available", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze(); h.hide();
  // Safari's own text ends with a period and names no camera.
  h.refuse(Object.assign(Error("The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission."), { name: "NotAllowedError" }));
  await h.$("clear-freeze").onclick();
  assert.equal(h.live.view, "frozen"); assert.equal(h.live.resumed, 0);
  assert.equal(h.$("camera-help").textContent, "Camera permission was denied. Save picture keeps this solution; Clear tries again.");
  assert.equal(h.$("clear-freeze").hidden, false); assert.equal(h.$("clear-freeze").disabled, false);
  assert.equal(h.$("start-camera").hidden, true, "Start preview cannot help without a stream");
  h.refuse(null);
  await h.$("clear-freeze").onclick();
  assert.equal(h.live.resumed, 1, "a later Clear can still succeed");
});

test("a camera that cannot start on Clear is named once, without a doubled period", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze(); h.hide();
  h.refuse(Object.assign(Error("Could not start video source."), { name: "NotReadableError" }));
  await h.$("clear-freeze").onclick();
  assert.equal(h.$("camera-help").textContent, "The camera could not turn on: Could not start video source. Save picture keeps this solution.");
  assert.equal(h.live.view, "frozen"); assert.equal(h.$("start-camera").hidden, true);
});

test("a Clear whose playback is interrupted offers Start preview and does not blame the camera", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  // Current WebKit rejects play() with an AbortError when the media session
  // cannot begin, during a phone call for one.
  h.setPlay(async () => { throw Object.assign(Error("The operation was aborted."), { name: "AbortError" }); });
  await h.$("clear-freeze").onclick();
  assert.equal(h.$("camera-help").textContent, "Camera playback was interrupted. Tap Start preview to resume the camera.");
  assert.equal(h.$("start-camera").hidden, false);
  assert.equal(h.live.view, "frozen"); assert.equal(h.track.stopped, 0, "the camera stays on");
  h.setPlay(async () => {});
  await h.$("start-camera").onclick();
  assert.equal(h.live.resumed, 1); assert.equal(h.$("start-camera").hidden, true);
});

test("turning the camera off while Start preview is offered leaves Save picture and Clear", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.setPlay(async () => { throw Object.assign(Error("Playback needs a tap"), { name: "NotAllowedError" }); });
  await h.$("clear-freeze").onclick();
  assert.equal(h.$("start-camera").hidden, false);
  assert.equal(h.$("video").srcObject, h.stream, "the stream stays attached through the refused Clear");
  h.hide();
  assert.equal(h.$("start-camera").hidden, true, "Clear is the way back");
  assert.equal(h.$("video").srcObject, null, "the stopped stream is detached");
  h.$("start-camera").onclick();
  assert.equal(h.requests, 1, "no retry is left for the stream that was turned off");
  h.setPlay(async () => {});
  await h.$("clear-freeze").onclick();
  assert.equal(h.requests, 2); assert.equal(h.live.resumed, 1);
});

test("a camera the system muted while frozen is kept: Clear says so and finishes when it unmutes", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.track.muted = true; // iOS: another app or a call holds the camera, or Split View.
  const plays = h.plays;
  await h.$("clear-freeze").onclick();
  assert.equal(h.track.stopped, 0, "the muted track is kept");
  assert.equal(h.requests, 1, "no getUserMedia: a new track would be muted too");
  assert.equal(h.plays, plays, "nothing to play yet");
  assert.equal(h.live.view, "frozen"); assert.equal(h.$("start-camera").hidden, true);
  assert.match(h.$("camera-help").textContent, /^Another app or the system is using the camera\. Save picture keeps this solution; Clear finishes/);
  assert.equal(h.$("clear-freeze").disabled, false);
  await h.$("clear-freeze").onclick(); // Another tap meanwhile waits on the same track.
  h.track.muted = false; h.track.events.unmute();
  await tick(); await tick();
  assert.equal(h.plays, plays + 1, "the camera is free: the Clear goes on");
  assert.equal(h.playedOn.at(-1), h.stream); assert.equal(h.live.resumed, 1);
  assert.equal(h.requests, 1);
});

test("a camera turned off while Clear waits for it to unmute stays off until the next tap", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.track.muted = true;
  await h.$("clear-freeze").onclick();
  h.hide(); // An app switch turns the camera off.
  const plays = h.plays;
  h.track.muted = false; h.track.events.unmute(); // A stale event from the stopped track.
  await tick(); await tick();
  assert.equal(h.requests, 1, "no getUserMedia outside a tap"); assert.equal(h.plays, plays);
  assert.equal(h.live.view, "frozen");
  assert.match(h.$("camera-help").textContent, /turned off while the app was in the background/);
  await h.$("clear-freeze").onclick();
  assert.equal(h.requests, 2, "Clear asks for the camera inside its tap"); assert.equal(h.live.resumed, 1);
});

test("Start preview for a silent stream waits for a muted camera as well", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  h.track.muted = true;
  const plays = h.plays;
  await h.$("start-camera").onclick();
  assert.equal(h.$("camera-help").textContent, "Another app or the system is using the camera. The preview resumes once it is free.");
  assert.equal(h.plays, plays); assert.equal(h.requests, 1); assert.equal(h.track.stopped, 0);
  await h.$("start-camera").onclick(); // Tapped again while it waits.
  h.track.muted = false; h.track.events.unmute();
  await tick(); await tick();
  assert.equal(h.plays, plays + 1, "one retry once the camera is free"); assert.equal(h.$("start-camera").hidden, true);
  assert.equal(h.live.view, "live");
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [3000], "and checks for frames again");
});

test("a track that ends while frozen turns the camera off instead of closing the panel", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.track.events.ended();
  assert.equal(h.$("camera-panel").hidden, false); assert.equal(h.liveStopped, 0);
  assert.equal(h.live.view, "frozen");
  assert.match(h.$("camera-help").textContent, /^The camera stopped\. Save picture keeps this solution.*may ask for camera access again\.$/);
  assert.equal(h.statuses.some(([text]) => /Camera disconnected/.test(text)), false);
  await h.$("clear-freeze").onclick();
  assert.equal(h.requests, 2); assert.equal(h.live.resumed, 1);
});

test("hiding the page after the camera was turned off keeps the line that says why", async (t) => {
  const h = await cameraHarness(t, { freshStreams: true });
  await h.$("camera").onclick(); h.live.freeze();
  h.track.events.ended();
  const stopped = h.$("camera-help").textContent;
  assert.match(stopped, /^The camera stopped\./);
  h.hide();
  assert.equal(h.$("camera-help").textContent, stopped, "an app switch finds no camera to turn off");
  // A refused Clear, then a trip to the Settings app to allow the camera.
  h.refuse(Object.assign(Error("Permission denied"), { name: "NotAllowedError" }));
  await h.$("clear-freeze").onclick();
  const denied = h.$("camera-help").textContent;
  assert.match(denied, /^Camera permission was denied\./);
  h.hide();
  assert.equal(h.$("camera-help").textContent, denied);
  h.refuse(null);
  await h.$("clear-freeze").onclick();
  assert.equal(h.live.resumed, 1, "Clear turns the camera back on");
});

for (const [how, turnOff] of [["an app switch", (h) => h.hide()], ["the track ending", (h) => h.track.events.ended()]])
  test(`a camera turned off while frozen by ${how} is reported to the diagnostics`, async (t) => {
    const h = await cameraHarness(t);
    await h.$("camera").onclick(); h.live.freeze();
    const reasons = () => h.diagnostics.snapshot().events.map((e) => `${e.stage}:${e.reason}`);
    assert.equal(reasons().includes("tracking:camera-released"), false);
    turnOff(h);
    assert.equal(reasons().at(-1), "tracking:camera-released");
    assert.equal(h.diagnostics.snapshot().reason, "camera-released", "the reason the diagnostics panel shows");
  });

test("Escape closes the camera from the frozen view", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera-panel").hidden, true); assert.equal(h.liveStopped, 1);
  assert.equal(h.track.stopped, 1);
  assert.equal(h.$("camera-panel").attributes["data-view"], "closed");
  assert.equal(h.$("clear-freeze").hidden, true); assert.equal(h.$("view-state").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera closed/);
});

test("the shutter while frozen shows the captured picture", async (t) => {
  const h = await cameraHarness(t, { capture: stillPicture() });
  await h.$("camera").onclick(); h.live.freeze();
  h.$("live-preview").setAttribute("data-view", "frozen"); // As the camera marks its canvas.
  await h.$("take-photo").onclick(); await tick();
  assert.equal(h.$("camera-panel").attributes["data-view"], "captured");
  assert.equal(h.$("live-preview").attributes["data-view"], "captured", "the canvas holds the stored picture");
  assert.equal(h.$("clear-freeze").hidden, true);
  assert.equal(h.$("retake-photo").hidden, false); assert.equal(h.track.stopped, 1);
});

// While live the screen shows the video, with at most an outline on the
// canvas: the shutter draws the stored picture there, so the panel shows
// exactly what is saved. A frozen capture is the canvas already.
test("a live shutter shows the stored picture on the canvas", async (t) => {
  const picture = { photo: {}, annotated: { width: 640, height: 480 }, found: null, corners: null, createdAt: 2, frozen: false };
  const h = await cameraHarness(t, { capture: picture });
  await h.$("camera").onclick();
  const view = h.$("live-preview");
  view.width = 700; view.height = 700;
  await h.$("take-photo").onclick(); await tick();
  assert.deepEqual(view.getContext("2d").draws, [picture.annotated]);
  assert.deepEqual([view.width, view.height], [640, 480], "at the picture's own size");
  assert.equal(view.attributes["data-view"], "captured"); assert.equal(view.attributes["data-overlay"], "composition");
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].annotated, picture.annotated, "the picture shown is the one stored");
  assert.equal(h.$("camera-panel").attributes["data-view"], "captured");
});

// The live view's label and counts described an outline and a reading; the
// stored picture replaces them with its own, which may have none.
test("a live shutter labels and counts the stored picture, with or without a reading", async (t) => {
  const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
  const found = { puzzle, cellUncertain: [1], markedCells: [0, 1, 2, 3, 5], notes: [] };
  const reading = { photo: {}, annotated: { width: 640, height: 480 }, found, corners: [], createdAt: 4, frozen: false };
  const h = await cameraHarness(t, { capture: reading });
  await h.$("camera").onclick();
  const view = h.$("live-preview");
  for (const [key, value] of Object.entries({ "aria-label": "Live camera. Grid outline shown; reading: 9 recognised, 0 uncertain, 0 unread clues.",
    "data-recognised": "9", "data-uncertain": "0", "data-unknown": "0", "data-delayed": "1" })) view.setAttribute(key, value);
  await h.$("take-photo").onclick(); await tick();
  assert.equal(view.attributes["aria-label"], "Saved picture: 3 recognised, 1 uncertain, 1 unread clues. Live results are not confirmed.");
  assert.deepEqual(["recognised", "uncertain", "unknown", "solution", "delayed"].map((key) => view.attributes[`data-${key}`]), ["3", "1", "1", "0", "0"]);
  await h.$("retake-photo").onclick();
  h.live.capture = () => ({ photo: {}, annotated: { width: 640, height: 480 }, found: null, corners: null, createdAt: 5, frozen: false });
  view.setAttribute("data-recognised", "9");
  await h.$("take-photo").onclick(); await tick();
  assert.equal(view.attributes["aria-label"], "Saved picture without a reading. Crop and read it in the editor.");
  assert.equal(view.attributes["data-recognised"], "0");
});

test("a frozen shutter draws nothing: the canvas already holds the stored picture", async (t) => {
  const picture = { photo: {}, annotated: { width: 640, height: 480 }, found: null, corners: null, createdAt: 3, frozen: true };
  const h = await cameraHarness(t, { capture: picture });
  await h.$("camera").onclick(); h.live.freeze();
  await h.$("take-photo").onclick(); await tick();
  assert.deepEqual(h.$("live-preview").getContext("2d").draws, []);
  assert.equal(h.$("live-preview").attributes["data-overlay"], "composition");
  assert.equal(h.saved[0].annotated, picture.annotated);
});

test("a resumed stream that delivers no frame for three seconds offers Start preview", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  const timers = manualTimers(t);
  await h.$("clear-freeze").onclick();
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [3000]);
  [...timers.values()][0].fn();
  assert.equal(h.$("start-camera").hidden, false);
  assert.match(h.$("camera-help").textContent, /No camera frame arrived/);
  await h.$("start-camera").onclick();
  assert.equal(h.$("start-camera").hidden, true, "Start preview plays the stream again");
  assert.equal(h.live.view, "live");
  h.live.stats.scheduling.observed = 3;
  const check = [...timers.values()].at(-1);
  assert.equal(check.ms, 3000); check.fn();
  assert.equal(h.$("start-camera").hidden, true, "frames arrived: nothing to offer");
});

test("a retry offered for a silent stream gives way when the view freezes", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick(); h.live.freeze();
  const timers = manualTimers(t);
  await h.$("clear-freeze").onclick();
  [...timers.values()][0].fn();
  assert.equal(h.$("start-camera").hidden, false);
  h.live.freeze(); // Frames arrived after all, and the grid was solved again.
  assert.equal(h.$("start-camera").hidden, true, "the frozen row holds only Save picture and Clear");
  assert.equal(await h.$("start-camera").onclick(), undefined, "no stale retry remains");
});

// Runs the one pending manual timer of `ms` and forgets it, as a browser does.
function fire(timers, ms) {
  const pending = [...timers.entries()].find(([, entry]) => entry.ms === ms);
  assert.ok(pending, `a ${ms}-ms timer is pending`);
  const [id, timer] = pending;
  timers.delete(id); timer.fn();
}
// Clear, then three seconds without a frame: Start preview is offered while
// the view is live.
async function silentAfterClear(t, h) {
  await h.$("camera").onclick(); h.live.freeze();
  const timers = manualTimers(t);
  await h.$("clear-freeze").onclick();
  fire(timers, 3000);
  assert.equal(h.$("start-camera").hidden, false);
  return timers;
}

test("a solution that freezes while Start preview's live retry plays stays frozen", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  const playback = deferred();
  h.setPlay(() => playback.promise);
  const retry = h.$("start-camera").onclick();
  await tick();
  h.live.freeze(); // Frames came after all, and the grid was solved meanwhile.
  playback.resolve(); await retry;
  assert.equal(h.live.view, "frozen", "a retry begun on the live view does not clear a new solution");
  assert.equal(h.live.resumed, 1, "only the Clear tap resumed");
  assert.equal(h.$("clear-freeze").hidden, false); assert.equal(h.$("clear-freeze").disabled, false);
  assert.equal(h.$("start-camera").hidden, true);
  assert.equal(timers.size, 0, "no frame check runs while frozen");
});

test("a freeze that aborts Start preview's live retry keeps the frozen help line", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  let pending = null;
  h.setPlay(() => { pending = deferred(); return pending.promise; });
  // As in browsers, pause() rejects a pending play() with an AbortError.
  const video = h.$("video"), pause = video.pause;
  video.pause = () => {
    pause();
    pending?.reject(Object.assign(Error("The play() request was interrupted by a call to pause()."), { name: "AbortError" }));
    pending = null;
  };
  const retry = h.$("start-camera").onclick();
  await tick();
  h.live.freeze();
  h.$("camera-help").textContent = "Solution preview — frozen."; // The camera's line at the freeze.
  await retry;
  assert.equal(h.$("camera-help").textContent, "Solution preview — frozen.", "the aborted retry writes nothing");
  assert.equal(h.live.view, "frozen"); assert.equal(h.live.resumed, 1);
  assert.equal(h.$("start-camera").hidden, true); assert.equal(h.$("clear-freeze").hidden, false);
  assert.equal(h.$("clear-freeze").disabled, false);
  assert.equal(timers.size, 0);
});

test("frames that arrive after the frame check take its Start preview back", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, false, "still no frame: the offer stands");
  h.live.stats.scheduling.observed = 2; // Frames after all; nothing freezes (automatic solving off).
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, true, "the retry is taken back");
  assert.equal(await h.$("start-camera").onclick(), undefined, "and no stale retry remains");
  assert.equal(timers.size, 0, "the check ends once frames arrive");
  assert.equal(h.live.view, "live");
});

test("a live retry that times out takes its Start preview back once frames arrive", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  h.setPlay(() => new Promise(() => {}));
  const retry = h.$("start-camera").onclick();
  await tick();
  fire(timers, 8000); await retry;
  assert.equal(h.$("start-camera").hidden, false, "the retry offers Start preview again");
  assert.match(h.$("camera-help").textContent, /No camera frame arrived/);
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, false, "still no frame: the offer stands");
  h.live.stats.scheduling.observed = 2; // The video plays after all; nothing freezes (automatic solving off).
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, true, "frames take the offer back, as they take the frame check's own");
  assert.equal(await h.$("start-camera").onclick(), undefined, "and no stale retry remains");
  assert.equal(timers.size, 0);
  assert.equal(h.live.view, "live");
});

// No frame check runs while a retry waits: one could take back the offer
// that the retry's own timeout then makes again, with nothing left to retry.
test("frames that arrive as a live retry times out still take its Start preview back", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  h.setPlay(() => new Promise(() => {}));
  const retry = h.$("start-camera").onclick();
  await tick();
  h.live.stats.scheduling.observed = 2; // Frames come in the retry's last moments...
  for (const [id, timer] of [...timers.entries()]) if (timer.ms === 500) { timers.delete(id); timer.fn(); }
  fire(timers, 8000); await retry; // ...too late for its play().
  assert.equal(h.$("start-camera").hidden, false, "the timed-out retry offers Start preview");
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, true, "the frames take the offer back");
  assert.equal(await h.$("start-camera").onclick(), undefined, "and no stale retry remains");
  assert.equal(timers.size, 0);
});

// Only frames since the retry's tap count: frames seen just before it (inside
// the frame check's 500-ms take-back window) say nothing about its playback.
test("frames seen before a live retry that then times out leave its new offer standing", async (t) => {
  const h = await cameraHarness(t);
  const timers = await silentAfterClear(t, h);
  h.live.stats.scheduling.observed = 2; // Frames, and the tap comes before the take-back check.
  h.setPlay(() => new Promise(() => {}));
  const retry = h.$("start-camera").onclick();
  await tick();
  fire(timers, 8000); await retry; // The retry's own playback times out.
  assert.equal(h.$("start-camera").hidden, false, "the timed-out retry offers Start preview");
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, false, "no frame since the retry: its offer stands");
  h.live.stats.scheduling.observed = 3; // A frame after the retry.
  fire(timers, 500);
  assert.equal(h.$("start-camera").hidden, true, "a frame since the retry takes the offer back");
  assert.equal(timers.size, 0);
});

function canvas(width = 600, height = 600) {
  const ctx = new Proxy({
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    drawImage(source) { this.source = source; },
  }, { get: (o, k) => o[k] ?? (() => {}) });
  return { width, height, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,aA==' };
}

function node(id) {
  const callbacks = new Map();
  return { ...canvas(), id, value: '', textContent: '', checked: false, hidden: false, disabled: false,
    open: false, style: {}, dataset: {}, focus() {}, scrollIntoView() {}, setAttribute() {},
    removeAttribute(key) { delete this[key]; },
    addEventListener(type, fn) { if (!callbacks.has(type)) callbacks.set(type, []); callbacks.get(type).push(fn); },
    emit(type) { for (const fn of callbacks.get(type) ?? []) fn({ type, target: this }); },
    pause() {}, load() {}, async play() {},
  };
}

function photoHarness(t) {
  const globals = ['document', 'window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  for (const id of ['scan-diagnostics', 'live-diagnostics'])
    $(id).querySelector = selector => $(id + '/' + selector.match(/"(.+)"/)[1]);
  const encoded = [];
  globalThis.document = { createElement() { const c = canvas(); encoded.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) },
  } });
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 1;
  const state = { puzzle, photo: canvas(), rectified: canvas(200, 200),
    corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }],
    puzzleSource: 7, photoSource: 7, photoRows: 2, photoCols: 2,
    uncertain: new Set([0]), cageUncertain: new Set(), blackReadings: [], needsReview: true,
    notes: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [], history: [] };
  let epoch = 0, capture, found, saved, detection = null;
  const errors = [], stopTask = () => ++epoch;
  const storage = { set: (_key, value) => { saved = value; }, get: key => key === 'gridpuzzle-session-v1' ? saved : null };
  const setLayout = layout => {
    state.layout = { ...layout };
    for (const [key, id] of [['rows', 'rows'], ['cols', 'cols'], ['boxRows', 'box-rows'], ['boxCols', 'box-cols']])
      $(id).value = String(layout[key]);
  };
  setLayout(puzzle); $('puzzle-type').value = 'latinsquare'; $('auto-capture').checked = true;
  const flow = setupPhotoFlow({ $, state, scanner: {
    read: async () => found,
    detect: async () => detection ?? ({ rows: found.puzzle.rows, cols: found.puzzle.cols, confidence: .99, corners: state.corners }),
  }, stopTask, invalidate: stopTask, begin: stopTask, finish() {}, fail: e => errors.push(e.message),
  render() {}, status() {}, remember() {}, persist: () => saveSession(storage, state), drawBoard() {},
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() {}, boxDefault: boxShape,
  setLayout, getJobId: () => epoch, setDeadline() {}, savePicture: async () => true,
  liveFactory({ diagnostics }) { return {
    start() { diagnostics.event({ stage: 'checking', reason: 'read-complete', found: capture.found }); },
    // Deliberately leave the prepared report in place: the handoff itself must
    // retire consent, independently of whether camera shutdown already did so.
    stop() {}, capture: () => capture, diagnosticSource: () => ({ image: capture.photo, verified: true }),
  }; } });
  t.after(() => { flow.stopCamera(); for (const [key, desc] of globals) {
    if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key];
  } });
  const diag = (id = 'scan-diagnostics') => Object.fromEntries(
    ['prepare', 'image-toggle', 'preview', 'error', 'image', 'download'].map(key => [key, $(id + '/' + key)]));
  return { $, state, errors, storage, encoded, diag, setLayout,
    setFound: value => { found = value; }, setCapture: value => { capture = value; },
    setDetection: value => { detection = value; } };
}

// Read on the crop of a detection that asked for manual corners (confidence at
// most 0.8) must not return clean-looking clues when nobody moved the handles.
function cleanReading() {
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 2;
  return { puzzle, cellUncertain: [], cageUncertain: [], blackReadings: [], needsReview: false, notes: [],
    rectified: canvas(200, 200) };
}
const detected = confidence => ({ rows: confidence > 0.8 ? 2 : 0, cols: confidence > 0.8 ? 2 : 0, confidence,
  corners: [{ x: 10, y: 10 }, { x: 590, y: 10 }, { x: 590, y: 590 }, { x: 10, y: 590 }] });
async function detectThenRead(h, confidence, adjust = () => {}) {
  h.setFound(cleanReading()); h.setDetection(detected(confidence));
  await h.$('detect-photo').onclick();
  adjust(h.$('crop-canvas'));
  h.$('read-photo').onclick(); await tick();
  assert.deepEqual(h.errors, []); assert.equal(h.state.puzzle.cells[0], 2);
}
for (const confidence of [0, 0.45, 0.8])
  test(`a Read on untouched corners from a ${confidence} detection puts every cell under review`, async t => {
    const h = photoHarness(t); await detectThenRead(h, confidence);
    assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]);
    assert.equal(h.state.needsReview, true);
    assert.match(h.state.notes[0], /corners were not adjusted/);
    const reloaded = restoreSession(h.storage);
    assert.deepEqual(reloaded.uncertain.sort(), [0, 1, 2, 3]); assert.equal(reloaded.needsReview, true);
  });
const adjustments = {
  pointer(crop) {
    crop.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600 });
    crop.setPointerCapture = () => {};
    crop.onpointerdown({ clientX: 12, clientY: 12, pointerId: 1, preventDefault() {} });
    crop.onpointermove({ clientX: 30, clientY: 25 }); crop.onpointerup();
  },
  keyboard(crop) {
    crop.onkeydown({ key: '3', preventDefault() {} });
    crop.onkeydown({ key: 'ArrowLeft', shiftKey: true, preventDefault() {} });
  },
};
for (const [how, adjust] of Object.entries(adjustments))
  test(`moving a corner by ${how} confirms an unconfident crop`, async t => {
    const h = photoHarness(t); await detectThenRead(h, 0.45, adjust);
    assert.deepEqual([...h.state.uncertain], []); assert.equal(h.state.needsReview, false);
    assert.deepEqual(h.state.notes, []);
  });
test('confident detections read as before, including after an unconfident one', async t => {
  const h = photoHarness(t); await detectThenRead(h, 0.45);
  await detectThenRead(h, 0.81);
  assert.deepEqual([...h.state.uncertain], []); assert.equal(h.state.needsReview, false);
  assert.deepEqual(h.state.notes, []);
  await detectThenRead(h, 0.94);
  assert.deepEqual([...h.state.uncertain], []); assert.equal(h.state.needsReview, false);
});

// A confident detection proposes its own size. Read at another size through
// its corners, unmoved, the cells need not be the grid's: every one is reviewed.
async function detectThenReadAs(h, rows, cols, adjust = () => {}, confidence = 0.94) {
  h.setFound(cleanReading()); h.setDetection({ ...detected(confidence), rows, cols });
  await h.$('detect-photo').onclick();
  h.$('rows').value = h.$('cols').value = '2';
  adjust(h.$('crop-canvas'));
  h.$('read-photo').onclick(); await tick();
  assert.deepEqual(h.errors, []); assert.equal(h.state.puzzle.cells[0], 2);
}
const resizedNote = (found, read) => `The grid was found with ${found} cells and read as ${read} through the same corners, so every cell is highlighted. Adjust the corners onto the grid's outer edge (moving any corner confirms them, even if they already sit there) and read again, or check each cell against the photograph.`;
for (const [rows, cols] of [[2, 3], [3, 2]])
  test(`a Read at another size than the ${rows} x ${cols} the detector found puts every cell under review, Read after Read`, async t => {
    const h = photoHarness(t); await detectThenReadAs(h, rows, cols);
    assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]); assert.equal(h.state.needsReview, true);
    assert.equal(h.state.notes[0], resizedNote(`${rows} × ${cols}`, '2 × 2'));
    // Reading again without moving a corner confirms nothing.
    h.$('read-photo').onclick(); await tick();
    assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]); assert.equal(h.state.notes[0], resizedNote(`${rows} × ${cols}`, '2 × 2'));
  });
test('rows and columns are compared as rows and columns', async t => {
  const h = photoHarness(t), puzzle = makePuzzle('numbrix', 2, 3); puzzle.cells[0] = 2;
  h.$('puzzle-type').value = 'numbrix';
  h.setFound({ ...cleanReading(), puzzle });
  for (const [rows, cols, review] of [[2, 3, false], [3, 2, true]]) {
    h.setDetection({ ...detected(0.94), rows, cols });
    await h.$('detect-photo').onclick();
    h.$('rows').value = '2'; h.$('cols').value = '3';
    h.$('read-photo').onclick(); await tick();
    assert.deepEqual(h.errors, []);
    assert.equal(h.state.uncertain.size, review ? 6 : 0, `found ${rows} x ${cols}, read 2 x 3`);
  }
});
for (const [how, adjust] of Object.entries(adjustments))
  test(`moving a corner by ${how} confirms a crop read at another size`, async t => {
    const h = photoHarness(t); await detectThenReadAs(h, 3, 3, adjust);
    assert.deepEqual([...h.state.uncertain], []); assert.deepEqual(h.state.notes, []);
  });
test('an unconfident detection read at another size keeps the note about unconfirmed corners', async t => {
  const h = photoHarness(t); await detectThenReadAs(h, 3, 3, () => {}, 0.8);
  assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]);
  assert.match(h.state.notes[0], /not found automatically/);
});
test('the size goes with the latest detection, and a lattice found along one axis proposes none', async t => {
  const h = photoHarness(t); await detectThenReadAs(h, 3, 3);
  await detectThenReadAs(h, 2, 2);
  assert.deepEqual([...h.state.uncertain], []); assert.deepEqual(h.state.notes, []);
  await detectThenReadAs(h, 3, 0);
  assert.deepEqual([...h.state.uncertain], []);
});
test('a reviewed live capture is confirmed at its own size, whatever an earlier photograph left', async t => {
  // An earlier photograph whose grid was not found, read through untouched corners.
  const h = photoHarness(t); await detectThenRead(h, 0.45);
  assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]);
  h.setCapture({ photo: canvas(), annotated: canvas(), corners: h.state.corners, createdAt: 1,
    found: { puzzle: makePuzzle('latinsquare', 2), notes: [], rectified: canvas(200, 200), cellUncertain: [], cageUncertain: [], needsReview: false } });
  await h.$('camera').onclick(); h.$('take-photo').onclick(); await tick(); h.$('use-live-capture').onclick();
  h.$('read-photo').onclick(); await tick();
  assert.deepEqual(h.errors, []); assert.deepEqual([...h.state.uncertain], []); assert.deepEqual(h.state.notes, []);
  // The live tracker read it at 2 x 2: another size through its corners is reviewed.
  h.$('rows').value = h.$('cols').value = '3';
  h.$('read-photo').onclick(); await tick();
  assert.deepEqual([...h.state.uncertain].sort(), [0, 1, 2, 3]); assert.equal(h.state.notes[0], resizedNote('2 × 2', '3 × 3'));
});

function cageWarnings() {
  const n = 9, cw = 40, width = n * cw, mask = new Uint8Array(width * width), groups = [];
  let serial = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n;) {
    const length = Math.min(r + 1, n - c);
    for (let k = 0; k < length; k++) groups[r * n + c + k] = serial;
    serial++; c += length;
  }
  const paint = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++)
    if (xx >= 0 && yy >= 0 && xx < width && yy < width) mask[yy * width + xx] = 1; };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (c < n - 1 && groups[r * n + c] !== groups[r * n + c + 1])
      for (const offset of [-3, 3]) paint((c + 1) * cw + offset - 1, r * cw, 2, cw);
    if (r < n - 1 && groups[r * n + c] !== groups[(r + 1) * n + c])
      for (const offset of [-3, 3]) paint(c * cw, (r + 1) * cw + offset - 1, cw, 2);
  }
  return { ...puzzleFromReadings({ entries: [], black: Array(n * n).fill(false),
    meta: { boxes: true, rows: n, cols: n }, mask, width, height: width }, 'killersudoku', n, n),
  rectified: canvas(900, 900) };
}

for (const proposed of [false, true]) test(`maximum cage warnings plus photo context round-trip, suggested boxes ${proposed}`, async t => {
  const h = photoHarness(t), found = cageWarnings(), originalNotes = [...found.notes]; assert.equal(found.notes.length, 8);
  h.setFound(found); h.setLayout(found.puzzle); h.$('puzzle-type').value = 'killersudoku';
  if (proposed) {
    h.setLayout({ ...found.puzzle, boxRows: 0 });
    await h.$('detect-photo').onclick();
  }
  retainPhotoSource(h.state.photo, new Blob(['controlled image I/O']), { width: 5000, height: 4000 });
  h.$('read-photo').onclick(); await tick(); assert.deepEqual(h.errors, []);
  assert.equal(h.state.notes.length, proposed ? 10 : 9);
  assert.deepEqual(h.state.notes.slice(0, 8), originalNotes);
  const backup = createBackup(h.state), restored = parsePuzzleFile(backup), reloaded = restoreSession(h.storage);
  for (const value of [restored, reloaded]) {
    assert.deepEqual(value.notes, h.state.notes); assert.equal(value.needsReview, true);
    assert.deepEqual(value.uncertain, [...h.state.uncertain]);
    assert.deepEqual(value.cageUncertain, [...h.state.cageUncertain]);
  }
  assert.throws(() => puzzleDefinition(h.state), /review/i);
});

for (const turns of [0, 1, 3]) test(`a reading taken ${turns} quarter turns off turns the crop corners with it`, async t => {
  const h = photoHarness(t), puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 2;
  const before = h.state.corners.map(p => ({ ...p }));
  h.setFound({ puzzle, cellUncertain: [], cageUncertain: [], blackReadings: [], needsReview: false, notes: [],
    rectified: canvas(200, 200), ...(turns ? { turns } : {}) });
  h.$('read-photo').onclick(); await tick(); assert.deepEqual(h.errors, []);
  assert.equal(h.state.puzzle.cells[0], 2);
  assert.deepEqual(h.state.corners, before.map((_, i) => before[(i + turns) % 4]));
});

test('notes have one bounded session/backup contract without losing flags, pending evidence or Play', t => {
  const h = photoHarness(t), s = h.state; s.puzzle = makePuzzle('hidato', 2); s.puzzle.cells[0] = '#';
  s.blackReadings = [{ cell: 0, value: 7 }]; s.play = [null, 2, null, null]; s.hints = new Set([1]);
  s.notes = Array.from({ length: MAX_REVIEW_NOTES + 5 }, (_, i) => String(i) + 'x'.repeat(MAX_REVIEW_NOTE_LENGTH));
  const r = parsePuzzleFile(createBackup(s, 'play'));
  assert.equal(r.notes.length, MAX_REVIEW_NOTES); assert.ok(r.notes.every(n => n.length === MAX_REVIEW_NOTE_LENGTH));
  assert.deepEqual(r.blackReadings, s.blackReadings); assert.deepEqual(r.uncertain, [0]);
  assert.deepEqual(r.play, s.play); assert.deepEqual(r.hints, [1]); assert.equal(r.needsReview, true);
  const b = createBackup(s); b.session.notes.push('extra'); assert.throws(() => parsePuzzleFile(b), /review metadata/);
  b.session.notes.pop(); b.session.notes[0] += 'x'; assert.throws(() => parsePuzzleFile(b), /review metadata/);
});

test('capture handoff retires prior diagnostic consent and uses the exact raw photo with fresh opt-in', async t => {
  const h = photoHarness(t), found = { puzzle: h.state.puzzle, notes: [], rectified: canvas(200, 200),
    cellUncertain: [0], cageUncertain: [], needsReview: false };
  const photo = canvas(), annotated = canvas();
  h.setCapture({ photo, annotated, found, corners: h.state.corners, createdAt: 1 });
  await h.$('camera').onclick(); const live = h.diag('live-diagnostics');
  live.prepare.onclick(); live['image-toggle'].checked = true; live['image-toggle'].onchange();
  assert.equal(live.download.disabled, false);
  h.$('take-photo').onclick(); await tick(); h.$('use-live-capture').onclick();
  assert.deepEqual(h.errors, []); assert.equal(h.state.photo, photo);
  assert.equal(h.state.photoSource, h.state.puzzleSource); assert.equal(h.state.needsReview, true);
  for (const panel of [h.diag(), live]) {
    assert.equal(panel['image-toggle'].checked, false); assert.equal(panel.download.disabled, true);
    assert.equal(panel.preview.textContent, ''); assert.equal(panel.image.src, undefined);
  }
  const diag = h.diag(); diag.prepare.onclick();
  const report = JSON.parse(diag.preview.textContent);
  assert.equal(report.source, 'photo'); assert.equal(report.readingVerifiedForImage, true);
  assert.equal(report.privacy.includesImage, false); assert.equal(report.image, undefined);
  assert.equal(report.lastReading.needsReview, true); assert.deepEqual(report.lastReading.cellUncertain, [0]);
  assert.equal(report.geometry.coordinateSpace, 'source-preview'); assert.deepEqual(report.geometry.corners, h.state.corners);
  diag['image-toggle'].checked = true; diag['image-toggle'].onchange();
  assert.equal(diag.error.textContent, ''); assert.equal(diag.download.disabled, false);
  assert.equal(h.encoded.at(-1).getContext('2d').source, photo);
  assert.notEqual(h.encoded.at(-1).getContext('2d').source, annotated);
  assert.equal(JSON.parse(diag.preview.textContent).privacy.includesImage, true);
  await h.$('camera').onclick();
  assert.equal(diag['image-toggle'].checked, false); assert.equal(diag.download.disabled, true);
  assert.equal(diag.image.src, undefined);
});

function readings(text = "3") {
  return { entries: [
    { kind: "value", cell: 0, text: "1", confidence: 99 },
    { kind: "blackvalue", cell: 4, text, confidence: 99 },
  ], black: [false, false, false, false, true, false, false, false, false],
  meta: { boxes: false, rows: 3, cols: 3 }, mask: new Uint8Array(900), width: 30, height: 30 };
}

function scanned() { return puzzleFromReadings(readings(), "auto", 3, 3); }

function stateFor(found) {
  return { ...found, uncertain: new Set(found.cellUncertain), cageUncertain: new Set(),
    history: [], play: [], hints: new Set() };
}

function webp(kind, width, height, prefix = false) {
  const size = kind === "VP8L" ? 5 : 10, extra = prefix ? 10 : 0,
    bytes = new Uint8Array(20 + size + size % 2 + extra), view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
  text(0, "RIFF"); text(8, "WEBP"); view.setUint32(4, bytes.length - 8, true);
  if (prefix) { text(12, "TEST"); view.setUint32(16, 1, true); }
  const at = 12 + extra, data = at + 8;
  text(at, kind); view.setUint32(at + 4, size, true);
  if (kind === "VP8L") { bytes[data] = 0x2f; view.setUint32(data + 1, (width - 1) | ((height - 1) << 14), true); }
  else if (kind === "VP8 ") { text(data + 3, "\x9d\x01\x2a"); view.setUint16(data + 6, width, true); view.setUint16(data + 8, height, true); }
  else for (const [pos, value] of [[data + 4, width - 1], [data + 7, height - 1]])
    for (let i = 0; i < 3; i++) bytes[pos + i] = (value >>> (i * 8)) & 255;
  return bytes;
}

function harness(t) {
  const descriptors = ["document", "Image", "createImageBitmap"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  t.after(() => { for (const [k, d] of descriptors) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } });
  const noop = () => {}, ctx = new Proxy({}, { get: (o, k) => o[k] ?? noop }),
    canvas = () => ({ width: 600, height: 600, getContext: () => ctx }), nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { ...canvas(), value: "", checked: false, hidden: false, style: {}, scrollIntoView: noop });
    return nodes.get(id);
  };
  globalThis.document = { createElement: canvas, addEventListener: noop };
  let bitmapCalls = 0, fullCalls = 0, closed = 0, epoch = 0, mappingsCleared = 0;
  globalThis.createImageBitmap = async (_file, options) => {
    bitmapCalls++; assert.ok(options.resizeWidth <= 1600);
    return { width: 1600, height: 1600, close() { closed++; } };
  };
  globalThis.Image = class { naturalWidth = 600; naturalHeight = 600; async decode() { fullCalls++; } };
  const state = stateFor(scanned()); state.photo = canvas();
  state.corners = [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }];
  const errors = [], scanner = { async detect() { return { rows: 3, cols: 3, confidence: 0.99, corners: state.corners }; } };
  const setLayout = (layout) => {
    state.layout = { ...layout };
    for (const [k, id] of [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]]) $(id).value = String(layout[k]);
  };
  setLayout({ rows: 3, cols: 3, boxRows: 1, boxCols: 3 });
  const stopTask = () => ++epoch;
  setupPhotoFlow({ $, state, scanner, stopTask, invalidate: stopTask, begin: stopTask, finish: noop,
    fail: (e) => errors.push(e.message), render: noop, status: noop, remember: () => rememberEdit(state),
    persist: noop, drawBoard: noop, clearPhotoMapping: () => mappingsCleared++, solveNow: noop,
    boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline: noop });
  return { $, state, scanner, errors, stopTask, counts: () => ({ bitmapCalls, fullCalls, closed, mappingsCleared }),
    import: (bytes) => $("photo-file").onchange({ target: { files: [new Blob([bytes])], value: "photo" } }) };
}

test("a highly compressed 36MP WebP takes the resized route, never full decode", async (t) => {
  const h = harness(t);
  await h.import(webp("VP8L", 6000, 6000));
  assert.deepEqual(h.errors, []);
  assert.equal(h.counts().bitmapCalls, 1); assert.equal(h.counts().fullCalls, 0); assert.equal(h.counts().closed, 1);
});

for (const bitmap of [undefined, async () => { throw Error("Unavailable"); }])
  test("36MP WebP is rejected before full decode when resized decoding is unavailable", async (t) => {
    const h = harness(t); globalThis.createImageBitmap = bitmap;
    await h.import(webp("VP8L", 6000, 6000));
    assert.equal(h.counts().fullCalls, 0); assert.match(h.errors[0], /cannot downscale/);
  });

test("unknown and above-budget images never reach either decoder", async (t) => {
  const h = harness(t);
  await h.import(new Uint8Array([1, 2, 3]));
  await h.import(webp("VP8X", 20000, 10000));
  assert.equal(h.errors.length, 2);
  assert.equal(h.counts().bitmapCalls, 0); assert.equal(h.counts().fullCalls, 0);
});

test("small WebP still has a safe full-decode fallback", async (t) => {
  const h = harness(t); globalThis.createImageBitmap = undefined;
  await h.import(webp("VP8L", 600, 600));
  assert.deepEqual(h.errors, []); assert.equal(h.counts().fullCalls, 1);
});

for (const outcome of ["success", "failure", "cancel"])
  test(`Find grid preserves undo and the puzzle on ${outcome}`, async (t) => {
    const h = harness(t), s = h.state;
    rememberEdit(s); s.puzzle.cells[0] = 2; rememberEdit(s); s.puzzle.cells[0] = 3;
    const history = structuredClone(s.history), before = structuredClone(s.puzzle), corners = s.corners;
    let resume;
    if (outcome === "failure") h.scanner.detect = async () => { throw Error("Detector unavailable"); };
    if (outcome === "cancel") h.scanner.detect = () => new Promise((resolve) => { resume = resolve; });
    const task = h.$("detect-photo").onclick();
    if (outcome === "cancel") { h.stopTask(); resume({ rows: 9, cols: 9, corners: [] }); }
    await task;
    assert.deepEqual(s.history, history); assert.deepEqual(s.puzzle, before);
    if (outcome !== "success") { assert.equal(s.corners, corners); assert.equal(h.counts().mappingsCleared, 0); }
    restoreEdit(s, s.history.pop()); assert.equal(s.puzzle.cells[0], 2);
  });
