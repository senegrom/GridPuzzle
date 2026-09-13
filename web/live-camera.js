import { Scanner } from "./scanner.js";
import { makePuzzle, boxShape, checkShape, TYPES } from "./model.js";
import { validQuad } from "./geometry.js";
import { gridContent, sameGridContent } from "./live-content.js";
import { createLiveSession } from "./live-session.js";
import { createLiveSolver } from "./live-solver.js";
import { drawLiveOverlay, overlayCells, sameFrame, SCAN_COLOURS } from "./live-overlay.js";

export function videoFrame(video, maxSide = 1600, target = null) {
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
  detector = new Scanner(), reader = new Scanner(), solver = createLiveSolver(),
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() }) {
  let active = false, timer = null, detection = null, epoch = 0, lastDetect = -Infinity;
  let raw = null, guide = null, initial = null, displayed = null, signature = null;
  let settingsKey = "", setting = null, currentPixels = null;
  const contentCanvas = document.createElement("canvas"), detectCanvas = document.createElement("canvas"), contentCache = new Map();
  function contentPixels(image) {
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    contentCanvas.width = Math.max(2, Math.round(image.width * scale));
    contentCanvas.height = Math.max(2, Math.round(image.height * scale));
    const ctx = contentCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, contentCanvas.width, contentCanvas.height);
    return ctx.getImageData(0, 0, contentCanvas.width, contentCanvas.height);
  }
  function contentOf(image, frame) {
    const pixels = image === raw ? (currentPixels ??= contentPixels(image)) : contentPixels(image);
    const corners = frame.corners.map((p) => ({ x: p.x * (pixels.width - 1) / (image.width - 1),
      y: p.y * (pixels.height - 1) / (image.height - 1) }));
    return gridContent(pixels, corners, frame.rows, frame.cols);
  }
  function isCurrent(frame) {
    if (!raw || !frame.content) return false;
    const key = JSON.stringify([frame.rows, frame.cols, frame.corners]);
    if (!contentCache.has(key)) contentCache.set(key, contentOf(raw, frame));
    return sameGridContent(frame.content, contentCache.get(key));
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
        { onPreview: (partial) => onPreview(boxed(partial)) }));
      // A live overlay is explicitly a preview. Capturing must not silently
      // confirm inferred rules or accept OCR on behalf of the user.
      found.needsReview = true;
      return found;
    },
    solve: (puzzle) => solver.solve(puzzle),
    // Realignment retires the pending read, not the warm OCR engine.
    cancelRead: () => reader.cancel({ keepEngine: true }),
    // Realignment retires answers, not an idle interpreter. Closing the camera
    // still cancels everything; older/injected solvers keep the cancel contract.
    cancelSolve: () => active && solver.invalidate ? solver.invalidate() : solver.cancel(),
    onChange: () => {}, onStatus: say, isCurrent, now, setTimer, clearTimer,
  });
  function render() {
    if (!raw) return;
    if (canvas.width !== raw.width) canvas.width = raw.width;
    if (canvas.height !== raw.height) canvas.height = raw.height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(raw, 0, 0);
    session.validate();
    const preview = session.preview;
    displayed = preview ?? (guide && initial ? { found: initial, corners: guide, result: null } : null);
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
    const labels = [["recognised", "Read"], ["uncertain", "Check ?"], ["unknown", "Unknown ?"], ["solution", "Solution"]];
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
      cancelDetection(); guide = initial = null; session.invalidate();
      say("Grid detection timed out. Keep the grid steady — retrying…");
    }, 8000);
    try {
      // Detection copies the pixels synchronously, so one canvas serves every call.
      const small = detectCanvas, scale = Math.min(1, 640 / Math.max(image.width, image.height));
      small.width = Math.round(image.width * scale); small.height = Math.round(image.height * scale);
      small.getContext("2d").drawImage(image, 0, 0, small.width, small.height);
      const found = await detector.detect(small);
      if (!current() || !sameFrame(frameSignature, signature)) return;
      const corners = found.corners?.map((p) => ({ x: p.x * (image.width - 1) / (small.width - 1), y: p.y * (image.height - 1) / (small.height - 1) }));
      if (found.confidence < .8 || !validQuad(corners, image.width, image.height)) {
        guide = initial = null; session.invalidate(); say("Keep the whole grid in view, in even light."); return;
      }
      const rows = found.rows || settings.rows, cols = found.cols || settings.cols;
      const selected = settings.rows === rows && settings.cols === cols;
      const [br, bc] = selected ? [settings.boxRows, settings.boxCols] : boxShape(rows);
      const puzzle = makePuzzle(settings.type === "auto" ? "hidato" : settings.type, rows, cols);
      puzzle.boxRows = br; puzzle.boxCols = bc;
      try { checkShape(puzzle); } catch (error) {
        // The detected grid contradicts the chosen rules (a 9 × 6 board for
        // Sudoku, a 12 × 12 Str8ts). Keep the outline, skip the cell overlay
        // and say why instead of failing every frame.
        guide = corners; initial = null; session.invalidate();
        say(`Detected ${rows} × ${cols}, which does not fit ${TYPES[puzzle.type]}: ${error.message} Change the puzzle type or the grid settings.`);
        return;
      }
      guide = corners; initial = { puzzle };
      if (!settings.enabled) { session.invalidate(); say("Automatic reading is paused (Grid size & settings). Capture to crop and read in the editor."); return; }
      if (found.sharpness < 60) { session.invalidate(); say("Move closer and hold still for sharper numbers."); return; }
      const frame = { image, signature: frameSignature, corners, width: image.width, height: image.height,
        rows, cols, boxRows: br, boxCols: bc, settings, key: `${key}:${rows}:${cols}:${br}:${bc}`, sharpness: found.sharpness };
      frame.content = contentOf(image, frame);
      session.observe(frame);
    } catch (error) {
      if (current()) { guide = initial = null; session.invalidate(); say(error.message || "Cannot find the grid. Adjust the camera."); }
    } finally {
      clearTimer(job.deadline);
      if (detection === job) detection = null;
    }
  }
  function tick() {
    if (!active) return;
    try {
      raw = videoFrame(video, 1600, raw); currentPixels = null; contentCache.clear(); signature = fingerprint(raw);
      const next = getSettings(), key = JSON.stringify([next, raw.width, raw.height]);
      if (key !== settingsKey) {
        settingsKey = key; setting = next; guide = initial = null;
        cancelDetection(); lastDetect = -Infinity; session.invalidate();
      }
      session.motion(signature);
      // Never paint a previous board after motion, even between detections.
      if (displayed?.sample && !sameFrame(displayed.sample.signature, signature)) guide = initial = null;
      render();
      // Detect quickly until something is on screen, then ease off.
      if (!detection && now() - lastDetect >= (session.preview ? 1000 : 300)) void locate(copyCanvas(raw), signature, setting, settingsKey, epoch);
    } catch (error) { say(error.message || "Waiting for the camera…"); }
    timer = setTimer(tick, 100);
  }
  return {
    start() { if (active) return; active = true; epoch++; lastDetect = -Infinity; session.start(); reader.prepare?.(); solver.prepare?.(); say(getSettings()?.enabled === false ? "Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor." : "Hold the grid steady. Recognition and solution appear here automatically."); timer = setTimer(tick, 100); },
    stop() { active = false; epoch++; clearTimer(timer); timer = null; cancelDetection(); session.stop(); reader.cancel(); raw = guide = initial = displayed = signature = null; settingsKey = ""; setting = currentPixels = null; contentCache.clear(); },
    capture() {
      if (!raw) throw Error("Wait for a camera frame before capturing.");
      // Validate the displayed raw frame, not a later camera frame. Never attach
      // stale metadata to a capture even when an async result arrived mid-tick.
      if (displayed?.sample && !isCurrent(displayed.sample)) { session.invalidate(); render(); }
      // Do not grab a different video frame here: preserve precisely the pixels
      // and overlay the user was looking at when pressing the shutter.
      return { photo: copyCanvas(raw), annotated: copyCanvas(canvas),
        found: displayed?.sample ? { ...displayed.found, puzzle: structuredClone(displayed.found.puzzle) } : null,
        corners: displayed?.corners?.map((p) => ({ ...p })) ?? null,
        createdAt: Date.now() };
    },
  };
}
