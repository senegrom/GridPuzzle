import { qualityMessage } from './scan-quality.js';
import { Scanner } from "./scanner.js";
import { makePuzzle, boxShape, checkShape, TYPES } from "./model.js";
import { validQuad } from "./geometry.js";
import { createLiveTracker } from "./live-tracker.js";
import { createLiveSession } from "./live-session.js";
import { createLiveSolver } from "./live-solver.js";
import { drawLiveOverlay, overlayCells, SCAN_COLOURS } from "./live-overlay.js";

function videoFrame(video, maxSide = 1600, target = null) {
  if (!video.videoWidth || !video.videoHeight) throw Error("The camera is not ready yet.");
  const canvas = target ?? document.createElement("canvas"), scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function copyCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width; canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return canvas;
}
let thumbnail = null;
export function fingerprint(image) {
  // One reusable 64 px canvas: this runs ten times a second.
  const canvas = thumbnail ??= document.createElement("canvas"); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 64, 64);
  const rgba = ctx.getImageData(0, 0, 64, 64).data, signature = new Uint8Array(4096);
  let at = 0;
  // 8x8 spatial blocks, not whole scanlines, for local change detection.
  for (let by = 0; by < 64; by += 8) for (let bx = 0; bx < 64; bx += 8)
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) {
      const i = 4 * (y * 64 + x);
      signature[at++] = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
    }
  return signature;
}

export function createLiveCamera({ $, video, canvas, getSettings,
  detector = new Scanner(), reader = new Scanner(), solver = createLiveSolver(), tracker = createLiveTracker(),
  diagnostics = null,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() }) {
  let active = false, timer = null, detection = null, epoch = 0, lastDetect = -Infinity;
  let raw = null, guide = null, guideFrame = null, displayed = null, signature = null;
  let settingsKey = "", setting = null, proofs = {}, pendingCandidate = null;
  let frameSerial = 0, displayedSerial = 0, sampledAt = -Infinity, retryTrackingAt = 0;
  const MAX_TRACK_AGE = 500;
  const contentCanvas = document.createElement("canvas"), detectCanvas = document.createElement("canvas");
  const release = image => { if (image) image.width = image.height = 0; };
  function discardCandidate() { release(pendingCandidate?.image); pendingCandidate = null; }
  function anchorIds() {
    return [...new Set([...session.trackingFrames, guideFrame, pendingCandidate]
      .map(frame => frame?.anchor?.id).filter(Number.isSafeInteger))].slice(0, 6);
  }
  function contentPixels(image) {
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    contentCanvas.width = Math.max(2, Math.round(image.width * scale));
    contentCanvas.height = Math.max(2, Math.round(image.height * scale));
    const ctx = contentCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, contentCanvas.width, contentCanvas.height);
    return ctx.getImageData(0, 0, contentCanvas.width, contentCanvas.height);
  }
  // Registration, feature extraction and all content checks live exclusively
  // in the worker. A proof is usable only with the pixels shown on the canvas.
  async function anchorOf(image, corners, rows, cols) {
    const pixels = contentPixels(image);
    const points = corners.map(p => ({ x: p.x * (pixels.width - 1) / (image.width - 1),
      y: p.y * (pixels.height - 1) / (image.height - 1) }));
    return (await tracker.anchor({ image: pixels, corners: points, rows, cols, anchors: anchorIds() })).anchor;
  }
  function isCurrent(frame) {
    if (!raw || !frame?.anchor || now() - sampledAt > MAX_TRACK_AGE) return false;
    const view = proofs[frame.anchor.id];
    return view ? { corners: view.corners.map(p => ({
      x: p.x * (raw.width - 1) / (view.width - 1), y: p.y * (raw.height - 1) / (view.height - 1),
    })) } : false;
  }
  function sameScene(a, b) {
    return a.anchor?.id === b.anchor?.id || b.anchor?.matches?.[a.anchor?.id] === true;
  }
  const say = (message) => { if (active) $("camera-help").textContent = message; };
  const session = createLiveSession({
    read: async (frame, progress, onPreview = () => {}) => {
      const boxed = (found) => {
        if (["sudoku", "killersudoku"].includes(found.puzzle.type)) {
          found.puzzle.boxRows = frame.boxRows; found.puzzle.boxCols = frame.boxCols;
        }
        return found;
      };
      const found = boxed(await reader.read(frame.image, frame.corners, frame.settings.type, frame.rows, frame.cols, progress,
        { onPreview: (partial) => onPreview(boxed(partial)), onDiagnostic: event => diagnostics?.event(event) }));
      // A live overlay is explicitly a preview. Capturing must not silently
      // confirm inferred rules or accept OCR on behalf of the user.
      found.needsReview = true;
      return found;
    },
    readCells: typeof reader.readCells === 'function' ? (frame, found, cells) =>
      reader.readCells(frame.image, frame.corners, found, cells, say,
        { onDiagnostic: event => diagnostics?.event(event) }) : null,
    onEvent: event => diagnostics?.event(event),
    solve: (puzzle) => solver.solve(puzzle),
    autoSolve: () => getSettings()?.autoSolve !== false,
    // Realignment retires the pending read, not the warm OCR engine.
    cancelRead: () => reader.cancel({ keepEngine: true }),
    // Realignment retires answers, not an idle interpreter. Closing the camera
    // still cancels everything; older/injected solvers keep the cancel contract.
    cancelSolve: () => active && solver.invalidate ? solver.invalidate() : solver.cancel(),
    onChange: () => {}, onStatus: say, isCurrent, sameScene, now, setTimer, clearTimer,
  });
  function render() {
    if (!raw) return;
    if (canvas.width !== raw.width) canvas.width = raw.width;
    if (canvas.height !== raw.height) canvas.height = raw.height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(raw, 0, 0);
    session.validate();
    const preview = session.preview;
    displayed = preview;
    guide = (guideFrame && isCurrent(guideFrame)?.corners) || preview?.corners || null;
    if (displayed) drawLiveOverlay(ctx, raw.width, raw.height, displayed.corners, displayed.found, displayed.result);
    if (guide) {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(2, raw.width / 500);
      ctx.beginPath(); guide.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    }
    // Retain the meaning of colours and the provisional nature in the PNG.
    const font = Math.max(13, Math.round(raw.width / 55)), bar = font * 2.1;
    ctx.fillStyle = "#101820e8"; ctx.fillRect(0, raw.height - bar, raw.width, bar);
    ctx.font = `600 ${font}px system-ui, sans-serif`; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.fillText("PREVIEW", font * .6, raw.height - bar / 2);
    const labels = [["recognised", "Read"], ["uncertain", "Check ?"], ["unknown", "Unread ?"], ["solution", "Solution"]];
    labels.forEach(([kind, label], i) => { ctx.fillStyle = SCAN_COLOURS[kind]; ctx.fillText(label, raw.width * (.18 + i * .205), raw.height - bar / 2); });
    const counts = { recognised: 0, uncertain: 0, unknown: 0, solution: 0 };
    for (const cell of displayed ? overlayCells(displayed.found, displayed.result) : []) counts[cell.kind]++;
    for (const [key, count] of Object.entries(counts)) canvas.dataset[key] = String(count);
    canvas.setAttribute("aria-label", `Camera preview: ${counts.recognised} recognised, ${counts.uncertain} uncertain, ${counts.unknown} unknown, ${counts.solution} solution entries. Live results are not confirmed.`);
  }
  function cancelDetection() {
    const job = detection;
    detection = null;
    if (job) clearTimer(job.deadline);
    detector.cancel();
  }
  async function locate(image, frameSignature, settings, key, owner) {
    const job = {};
    detection = job; lastDetect = now();
    const current = () => active && owner === epoch && key === settingsKey && detection === job;
    // Grid detection is small, bounded geometry work. Do not let a stalled
    // worker hold the live view hostage to the scanner's longer OCR timeout.
    job.deadline = setTimer(() => {
      if (!current()) return;
      cancelDetection(); guide = guideFrame = null; session.invalidate();
      say("Grid detection timed out. Keep the grid steady — retrying…");
    }, 8000);
    try {
      // Detection copies the pixels synchronously, so one canvas serves every call.
      const small = detectCanvas, scale = Math.min(1, 640 / Math.max(image.width, image.height));
      small.width = Math.round(image.width * scale); small.height = Math.round(image.height * scale);
      small.getContext("2d").drawImage(image, 0, 0, small.width, small.height);
      // A live frame is read the quick way: the last-resort readings cost
      // more than the interval between frames, and a grid held in front of
      // the camera is found without them.
      diagnostics?.event({stage:"detecting",reason:"started",background:session.busy || !!session.preview});
      const found = await detector.detect(small, { thorough: false, rows: settings.rows, cols: settings.cols });
      if (!current()) return;
      diagnostics?.geometry({ ...found, width: small.width, height: small.height, coordinateSpace: "detector-input" });
      const corners = found.corners?.map((p) => ({ x: p.x * (image.width - 1) / (small.width - 1), y: p.y * (image.height - 1) / (small.height - 1) }));
      if (found.confidence < .8 || !validQuad(corners, image.width, image.height)) {
        diagnostics?.event({stage:"detecting",reason:"no-grid"});
        guide = guideFrame = null; session.suspend(); say("Keep the whole grid in view, in even light."); return;
      }
      const rows = found.rows || settings.rows, cols = found.cols || settings.cols;
      const selected = settings.rows === rows && settings.cols === cols &&
        ["auto", "sudoku", "killersudoku"].includes(settings.type);
      const [br, bc] = selected ? [settings.boxRows, settings.boxCols] : boxShape(rows);
      const puzzle = makePuzzle(settings.type === "auto" ? "hidato" : settings.type, rows, cols);
      // Auto validates the boxes only after recognition chooses a boxed type.
      // Other families must never inherit hidden, possibly incomplete inputs.
      if (["sudoku", "killersudoku"].includes(puzzle.type)) {
        puzzle.boxRows = br; puzzle.boxCols = bc;
      }
      try { checkShape(puzzle); } catch (error) {
        // The detected grid contradicts the chosen rules (a 9 × 6 board for
        // Sudoku, a 12 × 12 Str8ts). Keep the outline, skip the cell overlay
        // and say why instead of failing every frame.
        guide = corners; guideFrame = null; session.invalidate();
        say(`Detected ${rows} × ${cols}, which does not fit ${TYPES[puzzle.type]}: ${error.message} Change the puzzle type or the grid settings.`);
        return;
      }
      job.anchoring = true;
      const anchor = await anchorOf(image, corners, rows, cols);
      if (!current()) return;
      if (!anchor) { session.suspend(); return; }
      const frame = { image, signature: frameSignature, corners, width: image.width, height: image.height,
        rows, cols, boxRows: br, boxCols: bc, settings, key: `${key}:${rows}:${cols}:${br}:${bc}`,
        anchor, content: anchor?.content };
      frame.warning = qualityMessage(found.quality) ||
        (!found.quality?.assessable && found.sharpness < 60 ? "Move closer and hold still for sharper numbers." : "");
      frame.sharpness = found.quality?.assessable ? found.quality.score : found.sharpness;
      frame.quality = found.quality;
      diagnostics?.event({stage:"quality",reason:found.quality?.reason || "found",background:session.busy || !!session.preview});
      // The detection's source is not necessarily the currently displayed
      // frame. Wait for an asynchronous proof before giving it to the session.
      discardCandidate(); pendingCandidate = frame; job.handedOff = true;
      void track(videoFrame(video), key, owner);
    } catch (error) {
      if (job.anchoring && current()) { trackingFailed(error, owner); return; }
      if (current()) { guide = guideFrame = null; session.invalidate(); say(error.message || "Cannot find the grid. Adjust the camera."); }
    } finally {
      if (!job.handedOff) image.width = image.height = 0;
      clearTimer(job.deadline);
      if (detection === job) detection = null;
    }
  }
  function trackingFailed(error, owner) {
    if (!active || owner !== epoch || error?.name === "AbortError") return;
    epoch++; retryTrackingAt = now() + 2000; proofs = {};
    tracker.reset(); discardCandidate(); cancelDetection();
    guide = guideFrame = null; session.invalidate(); lastDetect = -Infinity;
    diagnostics?.event({ stage: 'tracking', reason: 'worker-error', message: error.message });
    say("Background tracking is unavailable. Save a picture to read in the editor; retrying…");
    render();
  }
  async function track(image, key, owner) {
    const id = ++frameSerial, at = now(), pixels = contentPixels(image),
      width = pixels.width, height = pixels.height, anchors = anchorIds();
    let adopted = false;
    try {
      const result = anchors.length ? await tracker.verify({ image: pixels, anchors }) : { proofs: {} };
      if (!active || owner !== epoch || key !== settingsKey || id < displayedSerial || now() - at > MAX_TRACK_AGE) return;
      // Display this operation's actual source snapshot, never project a late
      // result onto a newer frame. The pending slot always holds the latest
      // capture, so a slow worker cannot build up a historic video queue.
      if (raw !== image) release(raw);
      raw = image; adopted = true; sampledAt = at; displayedSerial = id;
      proofs = Object.fromEntries(Object.entries(result.proofs).map(([anchor, view]) =>
        [anchor, view ? { ...view, width, height } : null]));
      signature = fingerprint(raw);
      session.motion(signature);
      const candidate = pendingCandidate;
      if (candidate && Object.hasOwn(result.proofs, candidate.anchor.id)) {
        pendingCandidate = null;
        const view = isCurrent(candidate);
        if (view) {
          guideFrame = { ...candidate, image: null }; guide = view.corners;
          if (!candidate.settings.enabled) {
            session.invalidate(); release(candidate.image);
            say("Automatic reading is paused (Grid size & settings). Capture to crop and read in the editor.");
          } else if (candidate.warning) {
            release(candidate.image); session.suspend(); say(candidate.warning);
          } else {
            session.observe(candidate); guideFrame = session.anchorFrame ?? guideFrame;
          }
        } else { release(candidate.image); session.suspend(); }
      }
      render();
      diagnostics?.tracking(tracker.stats, { frame: id, age: now() - at, matched: !!guide });
    } catch (error) { trackingFailed(error, owner); }
    finally { if (!adopted) release(image); }
  }
  function tick() {
    if (!active) return;
    let image;
    try {
      image = videoFrame(video);
      const next = getSettings(), identitySettings = { ...next };
      delete identitySettings.autoSolve;
      const key = JSON.stringify([identitySettings, image.width, image.height]);
      if (key !== settingsKey) {
        epoch++; diagnostics?.configure?.(next); settingsKey = key; setting = next; guide = guideFrame = null;
        tracker.reset(); discardCandidate(); proofs = {}; retryTrackingAt = 0;
        cancelDetection(); lastDetect = -Infinity; session.invalidate();
      }
      // On a stalled/unsupported worker the UI and manual shutter still work,
      // but no old proof or captured clue metadata survives the age deadline.
      if (!raw || now() - sampledAt > MAX_TRACK_AGE) {
        release(raw); raw = copyCanvas(image); proofs = {}; displayedSerial = frameSerial + 1;
        session.suspend(); render();
      } else { session.validate(); render(); }
      if (now() >= retryTrackingAt) {
        if (!detection && now() - lastDetect >= (session.preview ? 1000 : 300))
          void locate(copyCanvas(image), fingerprint(image), setting, settingsKey, epoch);
        void track(image, settingsKey, epoch); image = null;
      }
    } catch (error) { say(error.message || "Waiting for the camera…"); }
    finally { release(image); }
    timer = setTimer(tick, 100);
  }
  return {
    start() { if (active) return; active = true; epoch++; lastDetect = -Infinity; session.start(); reader.prepare?.(); solver.prepare?.(); say(getSettings()?.enabled === false ? "Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor." : "Hold the grid steady. Recognition and solution appear here automatically."); timer = setTimer(tick, 100); },
    stop() { active = false; epoch++; clearTimer(timer); timer = null; cancelDetection(); session.stop(); reader.cancel(); tracker.reset(); discardCandidate(); release(raw); raw = guide = guideFrame = displayed = signature = null; settingsKey = ""; setting = null; proofs = {}; sampledAt = -Infinity; },
    diagnosticSource() { return { image: raw, verified: !!isCurrent(session.anchorFrame) }; },
    capture() {
      if (!raw) throw Error("Wait for a camera frame before capturing.");
      // Validate the displayed raw frame, not a later camera frame. Never attach
      // stale metadata to a capture even when an async result arrived mid-tick.
      session.validate(); render();
      // Do not grab a different video frame here: preserve precisely the pixels
      // and overlay the user was looking at when pressing the shutter.
      return { photo: copyCanvas(raw), annotated: copyCanvas(canvas),
        found: displayed?.sample ? { ...displayed.found, puzzle: structuredClone(displayed.found.puzzle) } : null,
        corners: displayed?.corners?.map((p) => ({ ...p })) ?? null,
        createdAt: Date.now() };
    },
  };
}
