import { createTrackingRecovery, MAX_VERIFIED_TRACK_AGE } from "./tracking-recovery.js";
import { createFrameScheduler } from "./live-frame-scheduler.js";
import { qualityMessage } from './scan-quality.js';
import { Scanner } from "./scanner.js";
import { makePuzzle, boxShape, checkShape, TYPES } from "./model.js";
import { validQuad } from "./geometry.js";
import { createLiveTracker } from "./live-tracker.js";
import { createLiveSession, releaseImage } from "./live-session.js";
import { createLiveSolver } from "./live-solver.js";
import { drawLiveOverlay, overlayCells, SCAN_COLOURS } from "./live-overlay.js";

function videoFrame(video, maxSide = 1600) {
  if (!video.videoWidth || !video.videoHeight) throw Error("The camera is not ready yet.");
  const canvas = document.createElement("canvas"), scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
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
export function createLiveCamera({ $, video, canvas, getSettings,
  detector = new Scanner(), reader = new Scanner(), solver = createLiveSolver(), tracker = createLiveTracker(),
  diagnostics = null, solverWorker = null, onSolverReleased = null,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() }) {
  let active = false, detection = null, epoch = 0, lastDetect = -Infinity, trackAfter = -Infinity, anchorMs = 0;
  let ownVerifiedAt = -Infinity;
  let raw = null, guide = null, guideFrame = null, displayed = null;
  let settingsKey = "", setting = null, proofs = {}, pendingCandidate = null;
  let frameSerial = 0, adoptedAt = -Infinity, sampledAt = -Infinity, laggedAt = -Infinity, retryTrackingAt = 0;
  // Two tiers of verified display. A view is live while the snapshot on screen
  // is at most FRESH old. Once one is older, the view is still drawn — on its
  // own pixels, marked DELAYED — so a device whose worker takes a second per
  // frame gets a lagging overlay rather than none. It returns to live only
  // after snapshots have stayed within FRESH for LIVE_SETTLE: with replies of
  // 300-400 ms, or a worker pausing for an anchor, the snapshot's age crosses
  // FRESH on every reply, and the label would flip with it. A reply is adopted
  // while its own snapshot is within STALE; beyond that the display falls back
  // to an unverified frame and a worker that never answers reaches the
  // failure path.
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
  function discardCandidate() { release(pendingCandidate?.image); pendingCandidate = null; }
  // The pending candidate comes first: detection waits for its verdict.
  function anchorIds() {
    return [...new Set([pendingCandidate, ...session.trackingFrames, guideFrame]
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
    const view = proofs[frame.anchor.id];
    return view ? { corners: view.corners.map(p => ({
      x: p.x * (raw.width - 1) / (view.width - 1), y: p.y * (raw.height - 1) / (view.height - 1),
    })), stale: delayedTier() } : false;
  }
  function sameScene(a, b) {
    return a.anchor?.id === b.anchor?.id || b.anchor?.matches?.[a.anchor?.id] === true;
  }
  // One writer for the help line. The session dedups its own status, so the
  // camera's guidance goes through it too, and a later status is not skipped
  // as a repeat of a line that was overwritten in between.
  const say = (message) => { if (active) session.notify(message); };
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
    solve: (puzzle) => { prepareSolver(); return solver.solve(puzzle); },
    autoSolve: () => getSettings()?.autoSolve !== false,
    // Realignment retires the pending read, not the warm OCR engine.
    cancelRead: () => reader.cancel({ keepEngine: true }),
    // Realignment retires answers, not an idle interpreter; older/injected
    // solvers keep the cancel contract. Closing the camera goes to retireSolver.
    cancelSolve: () => !active ? retireSolver() : solver.invalidate ? solver.invalidate() : solver.cancel(),
    onChange: () => {}, onStatus: message => { $("camera-help").textContent = message; },
    // No verification runs while the worker builds an anchor.
    lossPaused: () => detection?.anchoring === true,
    isCurrent, sameScene, now, setTimer, clearTimer,
  });
  function render() {
    if (!raw) return;
    if (canvas.width !== raw.width) canvas.width = raw.width;
    if (canvas.height !== raw.height) canvas.height = raw.height;
    session.validate();
    const preview = session.preview;
    displayed = preview;
    guide = (guideFrame && isCurrent(guideFrame)?.corners) || preview?.corners || null;
    // A verified view in the delayed tier is drawn as delayed; only an
    // overlay or guide makes the distinction visible.
    const delayed = !!(guide || displayed) && delayedTier();
    // Validation still runs on every heartbeat. Only painting is deduplicated:
    // a freshness loss, solve toggle, tier change or new proposal repaints immediately.
    const visual = { raw, found: displayed?.found, result: displayed?.result, delayed,
      geometry: JSON.stringify([guide, displayed?.corners]) };
    if (lastPaint && Object.keys(visual).every(key => lastPaint[key] === visual[key])) {
      diagnostics?.rendering?.({ painted: false }); return;
    }
    const paintStarted = now(), ctx = canvas.getContext("2d"); ctx.drawImage(raw, 0, 0);
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
    if (delayed) {
      ctx.textAlign = "right"; ctx.fillStyle = SCAN_COLOURS.uncertain;
      ctx.fillText("DELAYED", raw.width - font * .6, raw.height - bar / 2); ctx.textAlign = "left";
    }
    const labels = [["recognised", "Read"], ["uncertain", "Check ?"], ["unknown", "Unread ?"], ["solution", "Solution"]];
    labels.forEach(([kind, label], i) => { ctx.fillStyle = SCAN_COLOURS[kind]; ctx.fillText(label, raw.width * (.18 + i * .205), raw.height - bar / 2); });
    const counts = { recognised: 0, uncertain: 0, unknown: 0, solution: 0 };
    for (const cell of displayed ? overlayCells(displayed.found, displayed.result) : []) counts[cell.kind]++;
    for (const [key, count] of Object.entries(counts)) canvas.dataset[key] = String(count);
    canvas.dataset.delayed = delayed ? "1" : "0";
    canvas.setAttribute("aria-label", `Camera preview: ${counts.recognised} recognised, ${counts.uncertain} uncertain, ${counts.unknown} unknown, ${counts.solution} solution entries.${delayed ? " The overlay is delayed behind the camera." : ""} Live results are not confirmed.`);
    lastPaint = visual;
    diagnostics?.rendering?.({ painted: true, milliseconds: now() - paintStarted });
  }
  function cancelDetection() {
    const job = detection;
    detection = null;
    if (job) clearTimer(job.deadline);
    detector.cancel();
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
        image.width = image.height = 0;
        if (current()) trackAfter = now() + trackGap();
      }
      clearTimer(job.deadline);
      if (detection === job) detection = null;
    }
  }
  function trackingFailed(error, owner) {
    if (!active || owner !== epoch || error?.name === "AbortError") return;
    epoch++; recovery.fail(); retryTrackingAt = recovery.nextAttempt; proofs = {};
    tracker.reset(); discardCandidate(); cancelDetection();
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
      width = pixels.width, height = pixels.height, anchors = anchorIds();
    let adopted = false;
    try {
      const result = anchors.length ? await tracker.verify({ image: pixels, anchors }) : { proofs: {} };
      if (active && owner === epoch) diagnostics?.tracking(tracker.stats, { frame: id, age: now() - at, matched: false });
      // Fence by snapshot time: a reply is adopted while its own snapshot is
      // within STALE and newer than the last adopted one, even if an
      // unverified fallback picture is on screen meanwhile.
      if (!active || owner !== epoch || key !== settingsKey || at <= adoptedAt || now() - at > STALE_TRACK_AGE) return;
      // Display this operation's actual source snapshot, never project a late
      // result onto a newer frame. The pending slot always holds the latest
      // capture, so a slow worker cannot build up a historic video queue.
      if (raw !== image) release(raw);
      raw = image; adopted = true; sampledAt = adoptedAt = at;
      proofs = Object.fromEntries(Object.entries(result.proofs).map(([anchor, view]) =>
        [anchor, view ? { ...view, width, height } : null]));
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
    delete identitySettings.autoSolve;
    const key = JSON.stringify([identitySettings, width, height]);
    if (key !== settingsKey) {
      epoch++; diagnostics?.configure?.(next); settingsKey = key; setting = next; guide = guideFrame = null;
      tracker.reset(); discardCandidate(); proofs = {}; retryTrackingAt = 0; recovery.reset();
      cancelDetection(); lastDetect = trackAfter = ownVerifiedAt = -Infinity; unmatchedCandidates = 0; session.invalidate();
    }
  }
  function updateRestartControl() {
    const button = $("restart-live");
    if (button) button.hidden = !active || (!recovery.blocked && unmatchedCandidates < 3 && (scheduler.fresh || !raw));
  }
  function heartbeat() {
    if (!active) return;
    if (video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      syncSettings(Math.max(1, Math.round(video.videoWidth * scale)), Math.max(1, Math.round(video.videoHeight * scale)));
    }
    if (!scheduler.fresh || sampleAge() > STALE_TRACK_AGE) {
      proofs = {}; guide = null;
      session.suspend();
      if (!scheduler.fresh && raw) {
        diagnostics?.event({ stage: 'tracking', reason: 'video-stalled' });
      }
    }
    prepareSolver();
    // Conditions the camera owns take the help line while they last.
    if (recovery.blocked) session.hold('Background tracking paused after repeated failures. Restart live scanning or save a picture for review.');
    else if (!scheduler.fresh && raw) session.hold('Waiting for a new camera frame. Old readings are hidden; capture to review.');
    else if (unmatchedCandidates >= 3 && !session.busy && !session.settled)
      session.hold('Grid detected, but the printed image is not matching between frames. Save picture to read a single frame in the editor, or restart live scanning.');
    else session.hold(null);
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
  function tick() {
    if (!active) return;
    let image;
    try {
      image = videoFrame(video);
      syncSettings(image.width, image.height);
      // On a stalled/unsupported worker the UI and manual shutter still work,
      // but no old proof or captured clue metadata survives the age deadline.
      if (!raw || sampleAge() > STALE_TRACK_AGE) {
        release(raw); raw = copyCanvas(image); proofs = {}; sampledAt = now();
        // This unverified picture is fresh, not a tracking proof. Clearing
        // proofs keeps it untrusted, and its own timestamp keeps each tick from
        // replacing it again. It does not fence replies in flight: one whose
        // snapshot is still within STALE is shown instead, on its own pixels.
        session.suspend(); render();
      } else { session.validate(); render(); }
      if (!recovery.blocked && now() >= retryTrackingAt) {
        // One candidate at a time: a new detection waits until a reply has
        // verified or rejected the pending one. Replacing it every 300 ms
        // meant that once replies took longer than that, no candidate was
        // ever verified and reading never started. Detections start every
        // 300 ms to acquire or re-find the grid; once a reading is shown, or
        // is running or finished with its own frame still verifying, they
        // follow trackGap() instead. Replies can be two seconds old and two
        // seconds apart, so "still" allows twice the stale limit.
        const tracked = !!session.preview ||
          ((session.busy || session.settled) && now() - ownVerifiedAt <= 2 * STALE_TRACK_AGE);
        if (!detection && !pendingCandidate && (tracked ? now() >= trackAfter : now() - lastDetect >= 300))
          void locate(copyCanvas(image), setting, settingsKey, epoch);
        void track(image, settingsKey, epoch); image = null;
      }
    } catch (error) { say(error.message || "Waiting for the camera…"); }
    finally { release(image); }
  }
  // One Python interpreter per page: the one the page already started serves
  // the previews instead of a second download and start-up, and closing the
  // camera hands an idle one back (retireSolver). Adopted last, so a camera
  // that fails to construct never holds it.
  if (solverWorker) solver.adopt ? solver.adopt(solverWorker) : solverWorker.terminate();
  return {
    start() { if (active) return; active = true; epoch++; lastDetect = trackAfter = ownVerifiedAt = -Infinity; session.start(); recovery.reset(); solverPrepared = false; reader.prepare?.(); prepareSolver(); say(getSettings()?.enabled === false ? "Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor." : "Hold the grid steady. Recognition and solution appear here automatically."); scheduler.start(); },
    stop() { active = false; epoch++; scheduler.stop(); cancelDetection(); session.stop(); reader.cancel(); tracker.reset(); discardCandidate(); recovery.reset(); release(contentCanvas); release(detectCanvas); release(raw); lastPaint = null; solverPrepared = false; unmatchedCandidates = 0; raw = guide = guideFrame = displayed = null; settingsKey = ""; setting = null; proofs = {}; sampledAt = adoptedAt = laggedAt = -Infinity; updateRestartControl(); },
    restart() {
      if (!active) return;
      epoch++; scheduler.stop(); cancelDetection(); tracker.reset(); discardCandidate();
      session.invalidate(); proofs = {}; guide = guideFrame = null; lastDetect = trackAfter = ownVerifiedAt = -Infinity;
      recovery.reset(); retryTrackingAt = 0; sampledAt = adoptedAt = laggedAt = -Infinity; unmatchedCandidates = 0;
      render(); scheduler.start(); updateRestartControl();
      diagnostics?.event({ stage: 'tracking', reason: 'worker-restarted' });
      say('Restarting live scanning. Waiting for a fresh verified frame…');
    },
    // Numeric lifecycle counters only; no image or retained puzzle data.
    get stats() { return { active, detection: detection ? 1 : 0, candidate: pendingCandidate ? 1 : 0,
      retainedSources: Number(!!raw) + Number(!!pendingCandidate?.image),
      scratchPixels: contentCanvas.width * contentCanvas.height + detectCanvas.width * detectCanvas.height,
      tracking: tracker.stats, scheduling: scheduler.stats, recovery: recovery.stats }; },
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
