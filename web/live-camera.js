import { createTrackingRecovery, MAX_VERIFIED_TRACK_AGE } from "./tracking-recovery.js";
import { createFrameScheduler } from "./live-frame-scheduler.js";
import { qualityMessage } from './scan-quality.js';
import { Scanner } from "./scanner.js";
import { makePuzzle, boxShape, checkShape, TYPES } from "./model.js";
import { validQuad } from "./geometry.js";
import { createLiveTracker } from "./live-tracker.js";
import { createLiveSession, releaseImage } from "./live-session.js";
import { createLiveSolver } from "./live-solver.js";
import { drawLiveOverlay, overlayCells, drawGuide, drawPreviewBar } from "./live-overlay.js";

// The size of a snapshot of the video: scaled uniformly to a long side of at
// most `maxSide`.
function frameSize(video, maxSide = 1600) {
  if (!video.videoWidth || !video.videoHeight) throw Error("The camera is not ready yet.");
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  return [Math.max(1, Math.round(video.videoWidth * scale)), Math.max(1, Math.round(video.videoHeight * scale))];
}
function videoFrame(video, maxSide = 1600) {
  const [width, height] = frameSize(video, maxSide), canvas = document.createElement("canvas");
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
// The help line while the view is frozen, and the condition for freezing: the
// result under which blue cells and Slitherlink edges are drawn (live-overlay.js).
const FROZEN_HELP = "Solution preview — frozen. Check the clues and rules. Save picture keeps it; Clear returns to the live camera.";
const solvedPreview = (preview) => preview?.result?.status === "unique" && preview.result.complete === true;
// The help line while a solved reading waits to freeze (readyToFreeze).
const SOLVED_WAITING = "Solution found — hold the grid steady for a moment…";
// The longest the freeze waits, from the first render that shows a reading
// solved, for a fresh frame and, with the setting "Wait up to 3 s for clearer
// clues before freezing" (freezeWait), for retries of its uncertain clues.
const REFINE_WAIT = 3000;
const COUNTED = ["recognised", "uncertain", "unknown", "solution"];
const frozenLabel = (counts) => `Frozen picture of the solved puzzle: ${counts.recognised} recognised, ${counts.uncertain} uncertain, ${counts.unknown} unread, ${counts.solution} solution entries. Live results are not confirmed.`;

export function createLiveCamera({ $, video, canvas, getSettings,
  detector = new Scanner(), reader = new Scanner(), solver = createLiveSolver(), tracker = createLiveTracker(),
  diagnostics = null, solverWorker = null, onSolverReleased = null, onViewChange = null,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() }) {
  let active = false, detection = null, epoch = 0, lastDetect = -Infinity, trackAfter = -Infinity, anchorMs = 0;
  let ownVerifiedAt = -Infinity;
  let raw = null, guide = null, guideFrame = null, displayed = null;
  // "live" while frames are sampled, tracked and read. The first render that
  // shows a verified, unique and complete solution freezes the view: the
  // canvas keeps that composition on its own frame (`raw`), and nothing is
  // sampled, detected, tracked, read or solved until resume() (Clear) or
  // stop(). `seenFrame`: a frame was processed since start() or resume(),
  // which `startedAt` dates, so a camera that delivers none can say so.
  // `pausedPicture`: Clear played the player paused at the freeze again
  // (resume()), and no frame it reported since has been processed: drawing
  // the video can still give the picture of the freeze (WebKit), so a live
  // capture waits.
  let view = "live", frozen = null, seenFrame = false, pausedPicture = false, startedAt = -Infinity, awaitingFirstFrame = false;
  let settingsKey = "", setting = null, proofs = {}, pendingCandidate = null;
  let frameSerial = 0, adoptedAt = -Infinity, sampledAt = -Infinity, laggedAt = -Infinity, retryTrackingAt = 0;
  // The freeze's wait (readyToFreeze): since when the reading whose sample
  // frame is `solvedReading` has been shown solved.
  let solvedSince = -Infinity, solvedReading = null;
  // Two tiers of verified evidence. `raw` is the adopted snapshot, the frame
  // the latest proofs verified; the video on screen is newer. The evidence is
  // live while that snapshot is at most FRESH old. Once one is older, the
  // outline over the video still follows it, marked as catching up in
  // `data-delayed` and the accessible label, so a device whose worker takes a
  // second per frame gets a trailing outline rather than none. It returns to
  // live only after snapshots have stayed within FRESH for LIVE_SETTLE: with
  // replies of 300-400 ms, or a worker pausing for an anchor, the snapshot's
  // age crosses FRESH on every reply, and the mark would flip with it. A reply
  // is adopted while its own snapshot is within STALE; beyond that the snapshot
  // and its proofs are dropped, and a worker that never answers reaches the
  // failure path. FRESH also bounds the frame a live capture keeps its reading
  // on and, for REFINE_WAIT, the frame the view freezes on.
  const FRESH_TRACK_AGE = 500, LIVE_SETTLE = 2000, STALE_TRACK_AGE = MAX_VERIFIED_TRACK_AGE;
  const recovery = createTrackingRecovery({ now });
  let lastPaint = null, solverPrepared = false, unmatchedCandidates = 0;
  function prepareSolver() {
    if (getSettings()?.autoSolve !== false && !solverPrepared) {
      solverPrepared = true; solver.prepare?.();
    }
  }
  // Closing the camera stops a running preview search, which only termination
  // can do, and hands an idle or warming interpreter to onSolverReleased, so
  // Solve after live scanning does not load Python again. Without a taker, or
  // with an injected solver that cannot release one, it is terminated.
  function retireSolver() {
    const idle = solver.release ? solver.release() : (solver.cancel(), null);
    if (idle) onSolverReleased ? onSolverReleased(idle) : idle.terminate();
  }
  const contentCanvas = document.createElement("canvas"), detectCanvas = document.createElement("canvas");
  const release = releaseImage;
  // The newest frame detection looked at, kept only while no frame is
  // adopted: while aiming, frames are sampled only for detection, and none is
  // adopted. A live capture on a stalled feed keeps it, as it keeps `raw`
  // (an interrupted iPhone camera draws black). Never both: an adoption
  // releases it.
  let scanned = null;
  function keepScanned(image) { if (scanned !== image) release(scanned); scanned = image; }
  function dropScanned() { release(scanned); scanned = null; }
  function discardCandidate() { release(pendingCandidate?.image); pendingCandidate = null; }
  // Every path that stops trusting the current proofs drops them here.
  function dropProofs() { proofs = {}; }
  const ids = frames => [...new Set(frames.map(frame => frame?.anchor?.id)
    .filter(Number.isSafeInteger))].slice(0, 6);
  // The anchors the worker keeps and compares each new detection with. The
  // pending candidate comes first: detection waits for its verdict.
  const anchorIds = () => ids([pendingCandidate, ...session.trackingFrames, guideFrame]);
  // The anchors a verification checks: only those whose proofs are read. Each
  // costs a full content comparison, about 100 ms for a 9x9 photograph on a
  // desktop, while the reference, the best frame and the challenger are
  // compared through their anchor-time matches. The guide outline needs its
  // own proof only without a preview, whose corners it otherwise follows.
  const verifyIds = () => ids([pendingCandidate, ...session.proofFrames, session.preview ? null : guideFrame]);
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
  const sampleAge = () => now() - sampledAt;
  // Detection spacing while a reading is tracked (see tick). A new detection
  // then only offers a sharper frame, clues to retry or a changed grid, which
  // verification notices too. The worker builds one anchor at a time and
  // verifies nothing meanwhile, so the spacing runs from the previous
  // candidate's verdict, not its start, and grows with the last anchor's cost:
  // an anchor over half the live tier ages the view onto the delayed tier,
  // which then holds for LIVE_SETTLE as well, and such pauses are kept to about
  // a quarter of the time.
  function trackGap() {
    const pause = anchorMs > FRESH_TRACK_AGE / 2 ? anchorMs + LIVE_SETTLE : anchorMs;
    return Math.max(1000, 3 * pause);
  }
  // Whether the verified view on screen is in the delayed tier (see above).
  function delayedTier() {
    if (!Object.values(proofs).some(Boolean)) return false;
    if (sampleAge() > FRESH_TRACK_AGE) laggedAt = now();
    return now() - laggedAt < LIVE_SETTLE;
  }
  function isCurrent(frame) {
    if (!raw || !frame?.anchor || !scheduler.fresh || sampleAge() > STALE_TRACK_AGE) return false;
    const proof = proofs[frame.anchor.id];
    return proof ? { corners: proof.corners.map(p => ({
      x: p.x * (raw.width - 1) / (proof.width - 1), y: p.y * (raw.height - 1) / (proof.height - 1),
    })), stale: delayedTier() } : false;
  }
  function sameScene(a, b) {
    return a.anchor?.id === b.anchor?.id || b.anchor?.matches?.[a.anchor?.id] === true;
  }
  // One writer for the help line. The session dedups its own status, so the
  // camera's guidance goes through it too, and a later status is not skipped
  // as a repeat of a line that was overwritten in between.
  const say = (message) => { if (active) session.notify(message); };
  const aiming = () => getSettings()?.enabled === false
    ? "Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor."
    : "Hold the grid steady. Recognition and solution appear here automatically.";
  // Detector guidance (no grid, a timeout, rules the grid contradicts) ends a
  // streak of rejected candidates: the alignment message the heartbeat holds
  // describes a grid that is still being found, and must not hide this one.
  const guidance = (message) => { unmatchedCandidates = 0; say(message); };
  const session = createLiveSession({
    read: async (frame, progress, onPreview = () => {}) => {
      const boxed = (found) => {
        if (["sudoku", "killersudoku"].includes(found.puzzle.type)) {
          found.puzzle.boxRows = frame.boxRows; found.puzzle.boxCols = frame.boxCols;
        }
        return found;
      };
      const found = boxed(await reader.read(frame.image, frame.corners, frame.settings.type, frame.rows, frame.cols, progress,
        { onPreview: (partial) => onPreview(boxed(partial)), onDiagnostic: event => diagnostics?.event(event),
          orient: false }));
      // A live overlay is explicitly a preview. Capturing must not silently
      // confirm inferred rules or accept OCR on behalf of the user.
      found.needsReview = true;
      return found;
    },
    readCells: typeof reader.readCells === 'function' ? (frame, found, cells) =>
      reader.readCells(frame.image, frame.corners, found, cells, say,
        { onDiagnostic: event => diagnostics?.event(event) }) : null,
    onEvent: event => diagnostics?.event(event),
    solve: (puzzle) => { prepareSolver(); return solver.solve(puzzle); },
    autoSolve: () => getSettings()?.autoSolve !== false,
    // Realignment retires the pending read, not the warm OCR engine.
    cancelRead: () => reader.cancel({ keepEngine: true }),
    // Realignment retires answers, not an idle interpreter; older/injected
    // solvers keep the cancel contract. Closing the camera goes to retireSolver.
    cancelSolve: () => !active ? retireSolver() : solver.invalidate ? solver.invalidate() : solver.cancel(),
    // A solved reading is never shown live: it freezes, or waits to. Its hold
    // (holdSolved), from its publication on, keeps the session's text for a
    // solution on screen ("Solution preview — check…") off the help line, a
    // polite live region, also when the reading returns after a blink. Only a
    // hold, never a render: validate() publishes on every call (render →
    // validate → onChange).
    onChange: (preview) => { if (active && view === "live" && solvedPreview(preview)) holdSolved(); },
    onStatus: message => { $("camera-help").textContent = message; },
    // No verification runs while the worker builds an anchor.
    lossPaused: () => detection?.anchoring === true,
    isCurrent, sameScene, now, setTimer, clearTimer,
  });
  // The counts of a reading, in the canvas's data attributes (the suites wait
  // on them), with the solution's only when a result is given.
  function countCells(found, result) {
    const counts = { recognised: 0, uncertain: 0, unknown: 0, solution: 0 };
    for (const cell of found ? overlayCells(found, result) : []) counts[cell.kind]++;
    for (const key of COUNTED) canvas.dataset[key] = String(counts[key]);
    return counts;
  }
  // The legend below the viewfinder shows the counts (data-count on each
  // colour's name, which CSS shows in the name's place) while a reading is
  // live or frozen: live video carries no clue digits. The solution is
  // counted only in the frozen picture, since none is drawn over live video.
  // `null` clears them.
  function showLegend(counts, solved = false) {
    for (const key of COUNTED) {
      const node = $(`legend-${key}`), value = counts && (solved || key !== "solution") ? String(counts[key]) : null;
      if (node?.getAttribute?.("data-count") === value) continue;
      if (value === null) node?.removeAttribute?.("data-count");
      else node?.setAttribute?.("data-count", value);
    }
  }
  // The canvas letterboxes its bitmap (raw's size) in the video's box like the
  // video, so raw coordinates land on the video only while raw has the
  // video's shape: not after a rotation or a change of stream resolution,
  // until syncSettings starts over with frames of the new shape, nor while
  // the video has no shape at all. The outline and the freeze need it (the
  // paused video stays visible behind the frozen still). Called only with raw.
  function aspectMatches() {
    const ratio = video.videoWidth / video.videoHeight;
    return Number.isFinite(ratio) && Math.abs(raw.width / raw.height - ratio) <= .005 * ratio;
  }
  // At the frame's own scale (two pixels, or a 500th of a 1200- to 1600-pixel
  // frame) the outline would be under a CSS pixel wide on a phone, whose
  // viewfinder shows the frame at a third of its size or less. Over live video
  // it is the only thing drawn, so there it is sized in CSS pixels through the
  // canvas's contain scale, with a dark halo for white paper; the frozen and
  // saved pictures keep the frame's scale, as does a canvas not laid out.
  const LIVE_LINE = 2.5, LIVE_HALO = 1;
  function liveStroke(width, height) {
    const scale = Math.min(canvas.clientWidth / width, canvas.clientHeight / height);
    return scale > 0 && Number.isFinite(scale) ? { line: LIVE_LINE / scale, halo: LIVE_HALO / scale } : {};
  }
  function liveLabel(mode, delayed, counts) {
    if (mode === "none") return "Live camera preview";
    const reading = displayed ? `; reading: ${counts.recognised} recognised, ${counts.uncertain} uncertain, ${counts.unknown} unread clues` : "";
    return `Live camera. Grid outline shown${reading}.${delayed ? " The overlay is catching up with the camera." : ""}`;
  }
  // The live video is the display. Over it this canvas is transparent and
  // holds only the outline of the latest verified proof, which can trail the
  // video by a reply: never clue digits, never a solution. A solved reading
  // freezes the view instead (readyToFreeze), on its own verified frame; at
  // the shutter (capture) it freezes without waiting.
  function render(shutter = false) {
    // A stopped camera paints nothing: the page may show a captured picture.
    if (!active || view !== "live") return;
    session.validate();
    displayed = session.preview;
    // With a preview the outline follows its corners; guideFrame is then not
    // verified at all (see verifyIds).
    guide = displayed?.corners || (guideFrame && isCurrent(guideFrame)?.corners) || null;
    if (raw && aspectMatches() && (shutter ? solvedPreview(displayed) : readyToFreeze())) { freezeNow(); return; }
    const mode = guide && aspectMatches() ? "outline" : "none";
    // The evidence's tier, as data-delayed and in the label; only an outline
    // or a reading makes it matter.
    const delayed = !!(guide || displayed) && delayedTier();
    const width = raw?.width ?? canvas.width, height = raw?.height ?? canvas.height;
    // Validation still runs on every heartbeat. Only painting is deduplicated,
    // on what the paint shows: the outline rounded to half a pixel, so
    // sub-pixel jitter of the proofs does not repaint, and the reading and
    // tier the counts and the label describe.
    const visual = { mode, width, height, found: displayed?.found, delayed,
      geometry: mode === "none" ? "" : guide.map(p => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`).join(" ") };
    if (lastPaint && Object.keys(visual).every(key => lastPaint[key] === visual[key])) {
      diagnostics?.rendering?.({ painted: false }); return;
    }
    const paintStarted = now();
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (mode === "outline") drawGuide(ctx, guide, width, liveStroke(width, height));
    const counts = countCells(displayed?.found, null);
    showLegend(displayed ? counts : null);
    canvas.dataset.overlay = mode;
    canvas.dataset.delayed = delayed ? "1" : "0";
    canvas.setAttribute("aria-label", liveLabel(mode, delayed, counts));
    lastPaint = visual;
    diagnostics?.rendering?.({ painted: true, milliseconds: now() - paintStarted });
  }
  // A preview is published only when its frame verifies on `raw` in this very
  // validation, so a solved one freezes on its own pixels. The freeze waits,
  // for at most REFINE_WAIT from the first render that showed this reading
  // solved, until raw is at most FRESH old, so the still does not jump back to
  // a framing the user has left, and, with the setting on (refineWait), until
  // no retry may still change an uncertain clue. The wait is keyed to the
  // reading's sample frame, which a blink, a merged retry and a re-solve keep
  // and a new full reading replaces. STALE still bounds the frame's age (the
  // preview needs a current proof).
  function readyToFreeze() {
    if (!solvedPreview(displayed)) return false;
    if (displayed.sample !== solvedReading) { solvedReading = displayed.sample; solvedSince = now(); }
    if (now() - solvedSince >= REFINE_WAIT) return true;
    return sampleAge() <= FRESH_TRACK_AGE && !(refineWait() && session.refining);
  }
  // "Wait up to 3 s for clearer clues before freezing", off by default. Read
  // at every freeze decision and kept out of the reading's identity
  // (syncSettings), so a change applies to the reading on screen at its next
  // render and resets nothing.
  function refineWait() { return getSettings()?.freezeWait === true; }
  // The help line for a solved reading that is not frozen yet. While the
  // freeze waits (readyToFreeze), for a fresh frame or, with the setting on,
  // for a retry, it asks the user to hold the grid steady; a reading that
  // this render or the next freezes keeps the line as it stands until the
  // frozen help replaces it.
  function holdSolved() {
    if (sampleAge() > FRESH_TRACK_AGE || (refineWait() && session.refining)) session.hold(SOLVED_WAITING);
    else session.keep();
  }
  // The frozen, captured and saved picture: the frame, its reading with the
  // given result, the outline and the bar with PREVIEW and the legend.
  function composeView(ctx, image, preview, result) {
    ctx.drawImage(image, 0, 0);
    if (preview) {
      drawLiveOverlay(ctx, image.width, image.height, preview.corners, preview.found, result);
      drawGuide(ctx, preview.corners, image.width);
    }
    drawPreviewBar(ctx, image.width, image.height);
  }
  // The one camera-frame paint of a live session: the solved composition on
  // the frame it was verified on, the picture that stays until Clear.
  function freezeNow() {
    const paintStarted = now();
    if (canvas.width !== raw.width) canvas.width = raw.width;
    if (canvas.height !== raw.height) canvas.height = raw.height;
    composeView(canvas.getContext("2d"), raw, displayed, displayed.result);
    const counts = countCells(displayed.found, displayed.result);
    showLegend(counts, true);
    canvas.dataset.overlay = "composition";
    canvas.dataset.delayed = "0";
    canvas.setAttribute("aria-label", frozenLabel(counts));
    diagnostics?.rendering?.({ painted: true, milliseconds: now() - paintStarted });
    enterFrozen();
  }
  function cancelDetection() {
    const job = detection;
    detection = null;
    if (job) clearTimer(job.deadline);
    detector.cancel();
  }
  // The freeze abandons a detection in flight rather than cancelling it:
  // cancelling an in-flight request terminates the detector's warm geometry
  // worker, which Clear would then start again. locate's current() fences the
  // reply by epoch and identity, and its finally releases the frame.
  function abandonDetection() {
    const job = detection;
    detection = null;
    if (job) clearTimer(job.deadline);
  }
  // Keep the solved composition: no frame is sampled and no detection,
  // tracking, OCR, retry or solve runs until Clear. The epoch fences every
  // continuation in flight, and the view fences the tick that froze (its
  // epoch is already the new one). The reading itself is retired: Clear
  // starts over, since a kept reading would refreeze on the next verified frame.
  function enterFrozen() {
    view = "frozen"; frozen = { preview: displayed };
    epoch++; scheduler.stop(); abandonDetection(); discardCandidate(); tracker.reset();
    dropProofs(); guideFrame = null; lastPaint = null; solvedReading = null;
    session.invalidate("frozen"); // The OCR engine and an idle interpreter are kept.
    canvas.setAttribute?.("data-view", "frozen");
    diagnostics?.event({ stage: "complete", reason: "frozen" });
    say(FROZEN_HELP);
    updateRestartControl();
    onViewChange?.("frozen");
  }
  async function locate(image, settings, key, owner) {
    const job = {};
    detection = job; lastDetect = now();
    const current = () => active && owner === epoch && key === settingsKey && detection === job;
    // Grid detection is small, bounded geometry work. Do not let a stalled
    // worker hold the live view hostage to the scanner's longer OCR timeout.
    job.deadline = setTimer(() => {
      if (!current()) return;
      cancelDetection(); guide = guideFrame = null; session.invalidate();
      guidance("Grid detection timed out. Keep the grid steady — retrying…");
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
        guide = guideFrame = null; session.suspend(); guidance("Keep the whole grid in view, in even light."); return;
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
        guidance(`Detected ${rows} × ${cols}, which does not fit ${TYPES[puzzle.type]}: ${error.message} Change the puzzle type or the grid settings.`);
        return;
      }
      // Anchoring is bounded by the tracker's own, longer anchor deadline; this
      // one covers detection only, which a slow anchor must not time out.
      job.anchoring = true; clearTimer(job.deadline);
      const anchorStarted = now(), anchor = await anchorOf(image, corners, rows, cols);
      anchorMs = now() - anchorStarted;
      if (!current()) return;
      if (!anchor) { session.suspend(); return; }
      const frame = { image, corners, width: image.width, height: image.height,
        rows, cols, boxRows: br, boxCols: bc, settings, key: `${key}:${rows}:${cols}:${br}:${bc}`,
        anchor };
      frame.warning = qualityMessage(found.quality) ||
        (!found.quality?.assessable && found.sharpness < 60 ? "Move closer and hold still for sharper numbers." : "");
      frame.sharpness = found.quality?.assessable ? found.quality.score : found.sharpness;
      frame.quality = found.quality;
      diagnostics?.event({stage:"quality",reason:found.quality?.reason || "found",background:session.busy || !!session.preview});
      // The detection's source is not necessarily the currently displayed
      // frame. Wait for an asynchronous proof before giving it to the session.
      discardCandidate(); pendingCandidate = frame; job.handedOff = true;
      // The next newly presented frame verifies this candidate. Do not sample
      // the video here: a delayed detector must not refresh a stalled feed.
    } catch (error) {
      if (job.anchoring && current()) { trackingFailed(error, owner); return; }
      if (current()) { guide = guideFrame = null; session.invalidate(); guidance(error.message || "Cannot find the grid. Adjust the camera."); }
    } finally {
      if (!job.handedOff) {
        // While nothing is adopted the frame is the newest one scanned (see
        // `scanned`); otherwise it is done with.
        if (current() && !raw) keepScanned(image); else release(image);
        if (current()) trackAfter = now() + trackGap();
      }
      clearTimer(job.deadline);
      if (detection === job) detection = null;
    }
  }
  function trackingFailed(error, owner) {
    if (!active || owner !== epoch || error?.name === "AbortError") return;
    epoch++; recovery.fail(); retryTrackingAt = recovery.nextAttempt; dropProofs();
    // No detection runs during the back-off or the pause, so no newer frame
    // would replace the scanned one.
    tracker.reset(); discardCandidate(); cancelDetection(); dropScanned();
    guide = guideFrame = null; session.invalidate(); lastDetect = trackAfter = ownVerifiedAt = -Infinity;
    diagnostics?.event({ stage: 'tracking', reason: 'worker-error', message: error.message });
    say(recovery.blocked
      ? "Background tracking repeatedly failed. Tap Restart live scanning, or save a picture to read in the editor."
      : "Background tracking is unavailable. Save a picture to read in the editor; retrying shortly…");
    diagnostics?.event({ stage: 'tracking', reason: recovery.blocked ? 'worker-paused' : 'worker-backoff' });
    updateRestartControl();
    render();
  }
  async function track(image, key, owner) {
    const id = ++frameSerial, at = now(), pixels = contentPixels(image),
      width = pixels.width, height = pixels.height, anchors = verifyIds();
    let adopted = false;
    try {
      const result = anchors.length ? await tracker.verify({ image: pixels, anchors }) : { proofs: {} };
      if (active && owner === epoch) diagnostics?.tracking(tracker.stats, { frame: id, age: now() - at, matched: false });
      // Fence by snapshot time: a reply is adopted while its own snapshot is
      // within STALE and newer than the last adopted one, also after an older
      // snapshot was dropped past STALE. A frozen view keeps its frame.
      if (!active || view !== "live" || owner !== epoch || key !== settingsKey || at <= adoptedAt || now() - at > STALE_TRACK_AGE) return;
      // Display this operation's actual source snapshot, never project a late
      // result onto a newer frame. The pending slot always holds the latest
      // capture, so a slow worker cannot build up a historic video queue.
      if (raw !== image) release(raw);
      raw = image; adopted = true; sampledAt = adoptedAt = at; dropScanned();
      proofs = Object.fromEntries(Object.entries(result.proofs).map(([anchor, proof]) =>
        [anchor, proof ? { ...proof, width, height } : null]));
      if (Object.values(proofs).some(Boolean)) { recovery.succeeded(); unmatchedCandidates = 0; }
      // Whether the reading's own frame still verifies. A rejection means the
      // grid moved away or its content changed, which only a new detection can
      // settle; a reply that is merely slow says nothing of the kind.
      const own = session.anchorFrame?.anchor?.id;
      if (own !== undefined && Object.hasOwn(result.proofs, own)) ownVerifiedAt = result.proofs[own] ? at : -Infinity;
      session.motion();
      const candidate = pendingCandidate;
      if (candidate && Object.hasOwn(result.proofs, candidate.anchor.id)) {
        pendingCandidate = null;
        const match = isCurrent(candidate);
        if (match) {
          guideFrame = { ...candidate, image: null }; guide = match.corners;
          if (!candidate.settings.enabled) {
            session.invalidate(); release(candidate.image);
            say("Automatic reading is paused (Grid size & settings). Capture to crop and read in the editor.");
          } else if (candidate.warning) {
            release(candidate.image); session.suspend(); say(candidate.warning);
          } else {
            session.observe(candidate); guideFrame = session.anchorFrame ?? guideFrame;
          }
        } else {
          release(candidate.image); session.suspend(); unmatchedCandidates++;
          const rejection = result.rejections?.[candidate.anchor.id];
          diagnostics?.event({ stage: 'tracking', reason: 'alignment-rejected',
            mismatch: rejection?.reason, region: rejection?.region });
        }
        trackAfter = now() + trackGap();
      }
      render();
      diagnostics?.tracking(tracker.stats, { frame: id, age: now() - at, matched: !!guide, stale: delayedTier(),
        rejection: Object.values(result.rejections ?? {})[0] });
    } catch (error) { trackingFailed(error, owner); }
    finally { if (!adopted) release(image); }
  }
  function syncSettings(width, height) {
    const next = getSettings(), identitySettings = { ...next };
    // Neither changes what is read: automatic solving and the freeze's wait
    // apply to the reading on screen.
    delete identitySettings.autoSolve; delete identitySettings.freezeWait;
    const key = JSON.stringify([identitySettings, width, height]);
    if (key !== settingsKey) {
      epoch++; diagnostics?.configure?.(next); settingsKey = key; setting = next; guide = guideFrame = null;
      tracker.reset(); discardCandidate(); dropProofs(); retryTrackingAt = 0; recovery.reset();
      cancelDetection(); lastDetect = trackAfter = ownVerifiedAt = -Infinity; unmatchedCandidates = 0; session.invalidate();
    }
  }
  function updateRestartControl() {
    const button = $("restart-live");
    if (button) button.hidden = !active || view !== "live" ||
      (!recovery.blocked && unmatchedCandidates < 3 && (scheduler.fresh || !seenFrame));
  }
  function heartbeat() {
    if (!active || view !== "live") return;
    if (video.videoWidth && video.videoHeight) syncSettings(...frameSize(video));
    // Old video, or verified evidence past the stale limit, retires the proofs
    // and hides what they verified. While aiming nothing is verified or
    // adopted, so the adopted frame is always "old": nothing is dropped then,
    // and the session's loss clock does not run for a grid never found.
    if ((!scheduler.fresh || sampleAge() > STALE_TRACK_AGE) &&
      (Object.keys(proofs).length || session.anchorFrame || guideFrame)) {
      dropProofs(); guide = null;
      session.suspend();
    }
    if (!scheduler.fresh && seenFrame) diagnostics?.event({ stage: 'tracking', reason: 'video-stalled' });
    prepareSolver();
    // Conditions the camera owns take the help line while they last. A
    // camera that has delivered no frame a second after start or Clear says
    // so; the line gives way to the aiming text when the first one arrives.
    const firstFrame = !seenFrame && now() - startedAt >= 1000;
    if (recovery.blocked) session.hold('Background tracking paused after repeated failures. Restart live scanning or save a picture for review.');
    else if (!scheduler.fresh && seenFrame) session.hold('Waiting for a new camera frame. Old readings are hidden; capture to review.');
    else if (firstFrame) session.hold('Waiting for the camera to deliver a picture…');
    else if (unmatchedCandidates >= 3 && !session.busy && !session.settled)
      session.hold('Grid detected, but the printed image is not matching between frames. Save picture to read a single frame in the editor, or restart live scanning.');
    // A solved reading that is not frozen yet keeps its hold (holdSolved): the
    // wait's text while it waits for a fresh frame or a retry (readyToFreeze).
    // No solution is shown over live video meanwhile.
    else if (solvedPreview(session.preview)) holdSolved();
    else { session.hold(null); if (awaitingFirstFrame) say(aiming()); }
    awaitingFirstFrame = firstFrame && !recovery.blocked;
    render(); updateRestartControl();
    diagnostics?.scheduling?.(scheduler.stats);
  }
  const scheduler = createFrameScheduler({ video, now, setTimer, clearTimer,
    onFrame: tick, onHeartbeat: heartbeat, onError: error => say(error.message || 'Waiting for the camera…'),
    // Back off expensive snapshots when tracking is slow or a reading is
    // settled, but stay below the live tier's 500ms. Never queue history.
    interval: () => Math.max(session.settled ? 250 : 100,
      Math.min(300, (tracker.stats?.milliseconds ?? 0) * 1.5)),
  });
  // The video is the display, so a frame is sampled only for the pipeline's
  // own work: to verify a candidate, the guide or a reading, and to detect.
  // While aiming at nothing that leaves one snapshot per detection, with no
  // tracking pixels read back.
  function tick() {
    if (!active || view !== "live") return;
    seenFrame = true; pausedPicture = false;
    const started = now();
    let image = null, sampled = false;
    try {
      syncSettings(...frameSize(video));
      // On a stalled/unsupported worker the video and the manual shutter still
      // work, but no old proof or captured clue metadata survives the age
      // deadline: the adopted snapshot and its proofs are dropped. It does
      // not fence replies in flight: one whose snapshot is still within STALE
      // is adopted, on its own pixels.
      if (raw && sampleAge() > STALE_TRACK_AGE) { release(raw); raw = null; dropProofs(); session.suspend(); }
      render();
      // The render may have frozen the view. This tick's frame must then not
      // be tracked or adopted: its epoch is already the frozen one.
      if (view !== "live" || recovery.blocked || now() < retryTrackingAt) return;
      // Verification needs anchors: a candidate, the guide or a reading. One
      // candidate at a time: a new detection waits until a reply has verified
      // or rejected the pending one. Replacing it every 300 ms meant that once
      // replies took longer than that, no candidate was ever verified and
      // reading never started. Detections start every 300 ms to acquire or
      // re-find the grid; once a reading is shown, or is running or finished
      // with its own frame still verifying, they follow trackGap() instead.
      // Replies can be two seconds old and two seconds apart, so "still"
      // allows twice the stale limit.
      const verify = verifyIds().length > 0;
      const tracked = !!session.preview ||
        ((session.busy || session.settled) && now() - ownVerifiedAt <= 2 * STALE_TRACK_AGE);
      const detect = !detection && !pendingCandidate && (tracked ? now() >= trackAfter : now() - lastDetect >= 300);
      if (!verify && !detect) return;
      image = videoFrame(video); sampled = true;
      // Detection gets the snapshot itself unless tracking adopts it.
      if (detect) void locate(verify ? copyCanvas(image) : image, setting, settingsKey, epoch);
      if (verify) void track(image, settingsKey, epoch);
      image = null;
    } catch (error) { say(error.message || "Waiting for the camera…"); }
    finally {
      release(image);
      // Main-thread time of a tick that took a snapshot, including the
      // synchronous readbacks for detection and tracking it started.
      if (sampled) diagnostics?.ticking?.(now() - started);
    }
  }
  // One Python interpreter per page: the one the page already started serves
  // the previews instead of a second download and start-up, and closing the
  // camera hands an idle one back (retireSolver). Adopted last, so a camera
  // that fails to construct never holds it.
  if (solverWorker) solver.adopt ? solver.adopt(solverWorker) : solverWorker.terminate();
  return {
    // The canvas may still carry a frozen or captured picture's state and
    // label from the session before (closed, or saved and scanned again).
    start() { if (active) return; active = true; epoch++; lastDetect = trackAfter = ownVerifiedAt = -Infinity; seenFrame = awaitingFirstFrame = pausedPicture = false; startedAt = now(); canvas.setAttribute?.("data-view", "live"); canvas.setAttribute?.("aria-label", "Live camera preview"); countCells(null, null); canvas.dataset.overlay = "none"; canvas.dataset.delayed = "0"; session.start(); recovery.reset(); solverPrepared = false; reader.prepare?.(); prepareSolver(); say(aiming()); scheduler.start(); },
    stop() { active = false; epoch++; view = "live"; frozen = null; seenFrame = awaitingFirstFrame = pausedPicture = false; startedAt = -Infinity; scheduler.stop(); cancelDetection(); session.stop(); reader.cancel(); tracker.reset(); discardCandidate(); recovery.reset(); release(contentCanvas); release(detectCanvas); release(raw); dropScanned(); lastPaint = null; solverPrepared = false; unmatchedCandidates = 0; raw = guide = guideFrame = displayed = solvedReading = null; settingsKey = ""; setting = null; dropProofs(); sampledAt = adoptedAt = laggedAt = -Infinity; showLegend(null); updateRestartControl(); },
    get view() { return view; },
    // Clear: discard the frozen picture and its reading and scan again from
    // nothing. The OCR engine, the geometry workers and an idle interpreter
    // stay warm; the page has already resumed the video. A double tap or a
    // call while live is a no-op. The first frame the video reports after
    // its pause is discarded: WebKit can still draw the picture of the freeze.
    // For the same reason a live capture waits for a frame that was scanned.
    resume() {
      if (!active || view !== "frozen") return;
      view = "live"; frozen = null; epoch++;
      release(raw); raw = displayed = guide = guideFrame = solvedReading = null; dropProofs(); lastPaint = null;
      lastDetect = trackAfter = ownVerifiedAt = -Infinity; sampledAt = adoptedAt = laggedAt = -Infinity;
      recovery.reset(); retryTrackingAt = 0; unmatchedCandidates = 0;
      seenFrame = awaitingFirstFrame = false; pausedPicture = true; startedAt = now();
      session.invalidate("cleared");
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      countCells(null, null); showLegend(null);
      canvas.dataset.overlay = "none"; canvas.dataset.delayed = "0";
      canvas.setAttribute?.("data-view", "live");
      canvas.setAttribute?.("aria-label", "Live camera preview");
      diagnostics?.event({ stage: "detecting", reason: "cleared" });
      say(aiming());
      scheduler.start({ discardFirst: true }); updateRestartControl();
      onViewChange?.("live");
    },
    restart() {
      if (!active || view !== "live") return;
      epoch++; scheduler.stop(); cancelDetection(); tracker.reset(); discardCandidate();
      session.invalidate(); dropProofs(); guide = guideFrame = null; lastDetect = trackAfter = ownVerifiedAt = -Infinity;
      recovery.reset(); retryTrackingAt = 0; sampledAt = adoptedAt = laggedAt = -Infinity; unmatchedCandidates = 0;
      render(); scheduler.start(); updateRestartControl();
      diagnostics?.event({ stage: 'tracking', reason: 'worker-restarted' });
      say('Restarting live scanning. Waiting for a fresh verified frame…');
    },
    // Numeric lifecycle counters only; no image or retained puzzle data.
    get stats() { return { active, view, detection: detection ? 1 : 0, candidate: pendingCandidate ? 1 : 0,
      retainedSources: Number(!!raw) + Number(!!pendingCandidate?.image) + Number(!!scanned),
      scratchPixels: contentCanvas.width * contentCanvas.height + detectCanvas.width * detectCanvas.height,
      tracking: tracker.stats, scheduling: scheduler.stats, recovery: recovery.stats }; },
    // The frozen frame is the verified frame of the frozen reading. Without an
    // adopted frame (none while aiming, or dropped past the stale limit, as
    // while tracking is paused after failures) the diagnostics get the
    // video's current frame, unverified and transient: the diagnostics UI
    // releases it once encoded; on a stalled feed, which may draw black, the
    // newest frame scanned, as a live capture does. The suites' pixel
    // witnesses use adoptedFrame() instead.
    diagnosticSource() {
      if (raw) return { image: raw, verified: view === "frozen" || !!isCurrent(session.anchorFrame) };
      if (scanned && !scheduler.fresh) return { image: scanned, verified: false };
      try { return { image: videoFrame(video), verified: false, transient: true }; } catch { return { image: null, verified: false }; }
    },
    // The adopted snapshot itself (the frame the latest proofs verified, or
    // the frozen frame), or null: the browser suites' witness of the scene the
    // camera has seen, now that the display canvas holds only an outline.
    adoptedFrame() { return raw; },
    // Never paints the display canvas (several suites probe with it), except
    // through the render that validates first, which may freeze the view.
    capture() {
      // Never attach stale metadata, even when an async result arrived
      // mid-tick: validate against the adopted frame first. This render
      // freezes a solved reading also while its freeze waits for a fresher
      // frame or a retry: the shutter ends that wait, since no retry can run
      // after it, and the help line has said that a solution was found. The
      // frozen picture, with the solution, is then saved.
      if (view === "live") render(true);
      if (view === "frozen") {
        // Exactly the frozen composition and its own frame and reading.
        const { found, corners } = frozen.preview;
        return { photo: copyCanvas(raw), annotated: copyCanvas(canvas),
          found: { ...found, puzzle: structuredClone(found.puzzle) }, corners: corners.map((p) => ({ ...p })),
          createdAt: Date.now(), frozen: true };
      }
      // Live, the screen shows the video. Only the verified frame has a
      // reading that belongs to its pixels (its corners and clues were proven
      // on it), so it is kept, with its reading, outline and bar but no
      // solution, while it is at most FRESH old and so matches what the user
      // saw. Otherwise the frame on screen now is kept without a reading: it
      // goes to the editor's crop and read. The page shows the returned
      // picture, which is what is stored.
      const preview = displayed, verified = !!(preview?.sample && raw && sampleAge() <= FRESH_TRACK_AGE);
      // Right after Clear the video can still draw the picture of the freeze
      // (resume()). As for scanning, only a frame reported after Clear counts,
      // so the shutter waits for one rather than store that old picture.
      if (!verified && pausedPicture) throw Error("Wait for a camera frame before capturing.");
      // While no new frame is presented the video may show nothing useful: iOS
      // paints an interrupted camera (a call, another app, Split View) black.
      // The newest picture scanned is kept instead: the last adopted frame,
      // or while aiming, where none is adopted, the last one detection saw.
      const kept = raw ?? scanned, stalled = !verified && !!kept && !scheduler.fresh;
      const image = verified ? raw : stalled ? copyCanvas(kept) : videoFrame(video), annotated = document.createElement("canvas");
      annotated.width = image.width; annotated.height = image.height;
      composeView(annotated.getContext("2d"), image, verified ? preview : null, null);
      if (!verified) return { photo: image, annotated, found: null, corners: null, createdAt: Date.now(), frozen: false };
      return { photo: copyCanvas(raw), annotated,
        found: { ...preview.found, puzzle: structuredClone(preview.found.puzzle) }, corners: preview.corners.map((p) => ({ ...p })),
        createdAt: Date.now(), frozen: false };
    },
  };
}
