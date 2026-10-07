import { onEditUndo } from "./edit-history.js";
import { fitReviewNotes } from "./session.js";
import { createScanDiagnostics } from "./scan-diagnostics.js";
import { setupDiagnosticsUI } from "./diagnostics-ui.js";
import { rotatePhotoSource, photoDetail, hasPhotoSource } from './photo-detail.js';
import { TYPES, checkShape, fitPlay, fitBlackReadings, makePuzzle } from "./model.js";
import { turnCorners, validQuad } from "./geometry.js";
import { importPhoto } from "./photo-import.js";
import { createLiveCamera } from "./live-camera.js";
import { cameraModal } from "./camera-modal.js";

export function setupPhotoFlow({
  $,
  state,
  scanner,
  stopTask,
  invalidate,
  begin,
  finish,
  fail,
  render,
  status,
  remember,
  persist,
  drawBoard,
  clearPhotoMapping,
  solveNow,
  boxDefault,
  setLayout,
  warmSolver,
  getJobId,
  setDeadline,
  savePicture,
  releaseSolver,
  adoptSolver,
  liveFactory = createLiveCamera,
}) {
  let stream = null,
    cameraEpoch = 0,
    drag = -1,
    // Corners from a detection that asked for manual corners (confidence at
    // most 0.8) and that the user has not moved since: Read may still run on
    // them, but its reading must come back entirely under review.
    unconfirmedCorners = false,
    // The size of the lattice the detector found through the corners, until
    // a corner moves: a Read at another size reads cells that are not the
    // grid's, and comes back entirely under review too.
    detectedLayout = null,
    proposedBoxLayout = null,
    live = null,
    pendingPlayback = null,
    playbackTimer = null,
    captured = null,
    saving = false,
    // The page's idle interpreter while the camera opens: the live previews
    // take it over once they start, and it goes back if they never do.
    parkedSolver = null,
    // A Clear tap in progress, and the check that a resumed stream delivers frames.
    resuming = null,
    frameCheck = null,
    // The muted camera track a Clear (or a retry) waits on, and that attempt.
    mutedWait = null;
  // Photo undo stores geometry/review metadata, never canvases or decoded
  // pixels. Each crop change has a distinct token, so an undo cannot rewind
  // a later detection or manual adjustment, even on the same photograph.
  const photoOwners = new WeakMap();
  let cropRevision = {};
  function photoOwner() {
    if (!state.photo) return null;
    if (!photoOwners.has(state.photo)) photoOwners.set(state.photo, {});
    return photoOwners.get(state.photo);
  }
  function rememberPhotoRead() {
    const owner = photoOwner(), before = {
      corners: state.corners.map((p) => ({ ...p })),
      proposedBoxLayout: proposedBoxLayout && { ...proposedBoxLayout },
      unconfirmedCorners, revision: cropRevision,
    }, after = {};
    const previous = state.history?.at(-1);
    remember();
    cropRevision = after;
    const snapshot = state.history?.at(-1);
    if (!snapshot || snapshot === previous) return;
    onEditUndo(state, snapshot, () => {
      // restoreEdit has restored the board/layout; the controls still show
      // the current photo layout until render. Preserve that layout if a
      // newer photograph/crop owns it instead of imposing this old one.
      if (photoOwner() === owner && cropRevision === after) {
        state.corners = before.corners.map((p) => ({ ...p }));
        proposedBoxLayout = before.proposedBoxLayout && { ...before.proposedBoxLayout };
        unconfirmedCorners = before.unconfirmedCorners;
        cropRevision = before.revision;
      } else {
        if (state.photo) setLayout(currentLayout());
        // A later crop of the same photograph carries its own confirmation
        // (a corner move or a detection). Only another photograph's crop was
        // never confirmed in this editor.
        if (photoOwner() !== owner) unconfirmedCorners = true;
      }
      // Results/cell crops belong to the undone read, not to its predecessor.
      // Nothing here revives an old photo, solver result or image consent.
      clearPhotoMapping();
      drag = -1;
      diagnostics.begin("photo", { ...(state.layout || state.puzzle), type: $("puzzle-type").value,
        autoSolve: $("auto-solve").checked });
      drawCrop();
    });
  }
  const returnSolver = (worker) => (adoptSolver ? adoptSolver(worker) : worker.terminate());
  const diagnostics = createScanDiagnostics();
  setupDiagnosticsUI({ $, diagnostics, getSource: () => diagnostics.snapshot().source === "live"
    ? (live?.diagnosticSource?.() ?? { image: null, verified: false })
    : { image: state.photo, verified: !!state.photoSource && state.photoSource === state.puzzleSource } });
  const modal = cameraModal($("camera-panel"), $("camera"));
  const CONSTRAINTS = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1440 },
    },
  };
  // The panel's state: live, frozen (a solved picture held until Clear),
  // captured or closed. Marking only: it never plays or pauses, and harness
  // nodes may lack dataset or setAttribute.
  function markView(view) {
    $("camera-panel").setAttribute?.("data-view", view);
    $("clear-freeze").hidden = view !== "frozen";
    $("view-state").hidden = view !== "frozen";
  }
  const videoTracks = () => stream ? (stream.getVideoTracks?.() ?? stream.getTracks?.() ?? []) : [];
  // A stream Clear can simply play again: its camera is still on.
  const streamUsable = () => {
    const track = videoTracks()[0];
    return !!track && track.readyState !== "ended";
  };
  // iOS mutes a live camera track while it cannot feed it: another app or a
  // call holds the camera, Split View, system pressure. A new track would be
  // muted as well and deliver no frame, so the track is kept, and the
  // attempt goes on when it unmutes.
  const BUSY = {
    frozen: "Another app or the system is using the camera. Save picture keeps this solution; Clear finishes once the camera is free.",
    live: "Another app or the system is using the camera. The preview resumes once it is free.",
  };
  // The latest attempt runs once, and only while the track is still the
  // page's camera (not closed, turned off or replaced meanwhile).
  function afterUnmute(track, attempt) {
    mutedWait = { track, attempt };
    track.addEventListener?.("unmute", () => {
      if (mutedWait?.track !== track) return;
      const wait = mutedWait;
      mutedWait = null;
      if (videoTracks()[0] === track) void wait.attempt();
    }, { once: true });
  }
  // The live camera froze its solved view, or Clear made it live again. The
  // camera stays on while frozen (the user's choice: no new permission
  // prompt, no start-up delay on Clear): its tracks stay live and enabled.
  // The video element is paused and detached from the stream, so no player
  // works behind the still, and Clear attaches the stream again inside its
  // tap. A new player calls back only with a frame it received: WebKit's
  // paused one keeps the frame of the freeze to draw while its presented
  // count runs on, so after a plain play() the first video-frame callback
  // could hand the camera that old picture.
  function onViewChange(view) {
    markView(view);
    if (view !== "frozen") return;
    const video = $("video");
    video.pause?.(); video.srcObject = null;
    // Frames arrived after all: a retry offered for a silent stream is moot,
    // and the frozen row holds only Save picture and Clear.
    clearTimeout(frameCheck); frameCheck = null;
    pendingPlayback = null; $("start-camera").hidden = true;
  }
  // A camera turned off while frozen, by the page being hidden or by the
  // system ending the track, leaves the frozen picture, its reading and Save
  // picture in place. Clear asks for the camera again, which can bring the
  // permission prompt back (Safari after a while without capture, a
  // home-screen app in a new session).
  const RELEASED = {
    hidden: "The camera was turned off while the app was in the background. Save picture keeps this solution; Clear turns it back on, and the phone may ask for camera access again.",
    ended: "The camera stopped. Save picture keeps this solution; Clear tries to turn it back on, and the phone may ask for camera access again.",
  };
  function releaseStream(cause) {
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    stream = null;
    $("video").srcObject = null;
    // Clear is the way back, asking for the camera inside its tap. A Start
    // preview offered for the old stream's playback has nothing left to play.
    pendingPlayback = null; $("start-camera").hidden = true;
    $("camera-help").textContent = RELEASED[cause];
    diagnostics.event({ stage: "tracking", reason: "camera-released" });
  }
  // Listen before playback starts: a track can end while the browser is
  // still deciding whether to play, and a dead stream must not sit behind
  // a "Start preview" button.
  function watchTracks(acquired, epoch) {
    for (const track of acquired.getTracks())
      track.addEventListener?.("ended", () => {
        if (epoch !== cameraEpoch || stream !== acquired) return;
        if (live?.view === "frozen") releaseStream("ended");
        else { stopCamera(); status("Camera disconnected.", "Your saved pictures and puzzle are unchanged.", "warning"); }
      }, { once: true });
  }
  // Set the properties as well as the HTML attributes before assigning a
  // MediaStream. WebKit can require explicit muted inline playback.
  function attachVideo() {
    const video = $("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    return video;
  }
  // The camera again after it was turned off while frozen, asked for inside
  // the Clear tap so that a browser that prompts again can.
  async function attachStream(epoch) {
    const acquired = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    if (epoch !== cameraEpoch || document.hidden) {
      acquired.getTracks().forEach((t) => t.stop());
      return false;
    }
    stream = acquired;
    watchTracks(acquired, epoch);
    attachVideo();
    return true;
  }
  // A playback promise can remain pending when a browser has connected a
  // stream but received no frame. Offer a recoverable explicit retry.
  function playWithTimeout(video) {
    let timer = null;
    return Promise.race([
      video.play(),
      new Promise((_, reject) => {
        timer = playbackTimer = setTimeout(() => reject(Object.assign(
          Error("No camera frame arrived. Tap Start preview to retry."),
          { name: "PreviewTimeout" },
        )), 8000);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      if (playbackTimer === timer) playbackTimer = null;
    });
  }
  // A stream that plays but delivers no frame for three seconds gets Start
  // preview. Frames that arrive later take that offer back, also with
  // automatic solving off, where no freeze would ever hide it. `offered`:
  // a live retry failed and offered Start preview again, so the check only
  // waits for frames to take it back.
  function watchFrames(epoch, offered = false) {
    clearTimeout(frameCheck);
    const check = (first) => {
      frameCheck = null;
      if (epoch !== cameraEpoch || live?.view !== "live") return;
      if (live.stats?.scheduling?.observed > 0) {
        if (!first && pendingPlayback === resumePlayback) { pendingPlayback = null; $("start-camera").hidden = true; }
        return;
      }
      if (first) {
        pendingPlayback = resumePlayback;
        $("start-camera").hidden = false;
        $("camera-help").textContent = "No camera frame arrived. Tap Start preview to retry.";
      }
      frameCheck = setTimeout(() => check(false), 500);
    };
    frameCheck = setTimeout(() => check(!offered), offered ? 500 : 3000);
  }
  // Clear: play the camera again inside the tap, asking for it first if it
  // was turned off meanwhile, and only then let the live camera scan anew.
  // The frozen picture stays on screen until playback has resumed, and stays
  // (with Save picture) if the camera cannot come back. Start preview calls
  // this again after a refused or stalled play(), and also while the view is
  // live, when the frame check offers it: only a call that began on a frozen
  // view may clear one, so a solution that freezes during that retry stays.
  // No frame check runs while a call waits, so none can take back an offer
  // that the call's failure then makes again; a live retry that fails
  // watches for frames to take its own offer back.
  async function resumePlayback() {
    const epoch = cameraEpoch;
    if (!live) return;
    const view = live.view, clearing = view === "frozen";
    pendingPlayback = resumePlayback;
    clearTimeout(frameCheck); frameCheck = null;
    $("start-camera").disabled = true; $("clear-freeze").disabled = true;
    let owner = null;
    try {
      const camera = videoTracks()[0];
      if (camera?.muted === true && camera.readyState !== "ended") {
        $("camera-help").textContent = clearing ? BUSY.frozen : BUSY.live;
        afterUnmute(camera, clearing ? clearFrozen : resumePlayback);
        return;
      }
      if (!streamUsable()) {
        for (const track of stream?.getTracks?.() ?? []) track.stop();
        stream = null;
        $("video").srcObject = null;
        $("camera-help").textContent = "Turning the camera back on…";
        if (!(await attachStream(epoch))) {
          if (epoch === cameraEpoch) $("camera-help").textContent = RELEASED.hidden;
          return;
        }
      } else attachVideo(); // The stream the freeze detached, inside the tap, before play().
      owner = stream;
      await playWithTimeout($("video"));
      // Closed, captured or released meanwhile: that path's own state stands.
      if (epoch !== cameraEpoch || !live || stream !== owner) return;
      pendingPlayback = null;
      $("start-camera").hidden = true;
      if (clearing && live.view === "frozen") live.resume?.();
      // A solution that froze while a live retry played stays as it is.
      if (live.view !== "live") return;
      $("take-photo").focus?.();
      watchFrames(epoch);
    } catch (error) {
      // Closed, captured, or the stream released or replaced meanwhile
      // (play() then rejects): that path's own text stands. So does a view
      // that froze meanwhile: the freeze pauses the video, which rejects a
      // pending play() with an AbortError.
      if (epoch !== cameraEpoch || (owner && stream !== owner) || live?.view !== view) return;
      // With a stream, play() itself failed: refused without a gesture,
      // silent, or interrupted (WebKit rejects it with an AbortError while a
      // call or another app holds the media session). The camera is on, so
      // Start preview retries. Without one, getUserMedia failed.
      if (stream && ["NotAllowedError", "PreviewTimeout", "AbortError"].includes(error.name)) {
        $("start-camera").hidden = false;
        $("camera-help").textContent = error.name === "PreviewTimeout" ? error.message
          : error.name === "AbortError" ? "Camera playback was interrupted. Tap Start preview to resume the camera."
          : "Tap Start preview to resume the camera.";
        if (view === "live") watchFrames(epoch, true);
      } else $("camera-help").textContent = error.name === "NotAllowedError"
        ? "Camera permission was denied. Save picture keeps this solution; Clear tries again."
        : `The camera could not turn on: ${String(error.message || "unavailable").replace(/[.\s]+$/, "")}. Save picture keeps this solution.`;
    } finally {
      if (epoch === cameraEpoch) { $("start-camera").disabled = false; $("clear-freeze").disabled = false; }
    }
  }
  function stopCamera() {
    cameraEpoch++;
    live?.stop();
    live = null;
    if (parkedSolver) {
      const worker = parkedSolver;
      parkedSolver = null;
      returnSolver(worker);
    }
    pendingPlayback = null;
    clearTimeout(playbackTimer); playbackTimer = null;
    clearTimeout(frameCheck); frameCheck = null;
    // A Clear cut short by the close must not leave its button disabled.
    resuming = null; $("clear-freeze").disabled = false;
    markView("closed");
    $("start-camera").hidden = true;
    document.body?.classList.remove("camera-open");
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    $("video").srcObject = null;
    $("camera-panel").hidden = true;
    modal.close();
    captured = null;
  }
  async function openCamera() {
    stopTask();
    stopCamera();
    // Previews that solve take over the page's interpreter; without automatic
    // solving the camera needs none, and the interpreter is released as before.
    parkedSolver = releaseSolver?.($("auto-solve").checked === true) ?? null;
    captured = null;
    const previewCanvas = $("live-preview");
    previewCanvas.getContext?.("2d")?.clearRect?.(0, 0, previewCanvas.width, previewCanvas.height);
    $("take-photo").hidden = false;
    $("take-photo").disabled = saving;
    $("retake-photo").hidden = $("download-live-capture").hidden = $("use-live-capture").hidden = true;
    const epoch = cameraEpoch;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("Live camera access needs HTTPS and a compatible browser.");
      status("Opening camera…", "Please allow camera access.");
      const acquired = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      if (epoch !== cameraEpoch) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = acquired;
      watchTracks(acquired, epoch);
      $("camera-panel").hidden = false;
      modal.open();
      markView("live");
      $("close-camera").focus?.();
      const video = attachVideo();
      document.body?.classList.add("camera-open");
      const startPreview = async () => {
        if (epoch !== cameraEpoch || live) return;
        $("start-camera").disabled = true;
        try {
          await playWithTimeout(video);
          if (epoch !== cameraEpoch) return;
          pendingPlayback = null;
          $("start-camera").hidden = true;
          status("Camera ready.", "Hold a clear grid steady; the shutter saves the view.");
          diagnostics.begin("live", { type: $("puzzle-type").value, rows: Number($("rows").value), cols: Number($("cols").value), autoSolve: $("auto-solve").checked });
          live = liveFactory({ $, video, canvas: $("live-preview"), diagnostics,
            getSettings: () => ({
              type: $("puzzle-type").value,
              rows: Number($("rows").value), cols: Number($("cols").value),
              boxRows: Number($("box-rows").value), boxCols: Number($("box-cols").value),
              enabled: $("auto-capture").checked,
              autoSolve: $("auto-solve").checked,
            }),
            solverWorker: parkedSolver,
            onSolverReleased: returnSolver,
            onViewChange,
          });
          parkedSolver = null;
          live.start();
        } catch (error) {
          if (epoch !== cameraEpoch) return;
          if (["NotAllowedError", "PreviewTimeout"].includes(error.name)) {
            // Camera permission may be granted while autoplay is disallowed.
            // Keep the acquired stream and let an explicit user gesture start it.
            $("start-camera").hidden = false;
            $("camera-help").textContent = error.name === "PreviewTimeout"
              ? error.message : "Camera connected. Tap Start preview to allow video playback.";
            return;
          }
          stopCamera();
          status("Camera preview could not start.", error.message || "Please retry the camera.", "warning");
        } finally {
          if (epoch === cameraEpoch) $("start-camera").disabled = false;
        }
      };
      pendingPlayback = startPreview;
      await startPreview();
    } catch (e) {
      if (epoch !== cameraEpoch) return;
      stopCamera();
      $("native-camera").hidden = false;
      status(
        "Live camera could not open.",
        `${e.name === "NotAllowedError" ? "Camera permission was denied." : e.message} Choose a photo or use the phone’s camera app instead.`,
        "warning",
      );
    }
  }
  $("camera").onclick = openCamera;
  const closeCamera = () => {
    stopCamera();
    status("Camera closed.", "Your puzzle and saved pictures are unchanged.");
  };
  $("close-camera").onclick = closeCamera;
  document.addEventListener("keydown", (event) => {
    // The camera panel covers the whole screen; Escape must leave it like a dialog.
    if (event.key === "Escape" && !$("camera-panel").hidden) { event.preventDefault?.(); closeCamera(); }
  });
  $("restart-live").onclick = () => live?.restart?.();
  // Clear, from its button or once a muted camera is free: one at a time.
  function clearFrozen() {
    if (live?.view !== "frozen" || resuming) return;
    const attempt = resuming = resumePlayback().finally(() => { if (resuming === attempt) resuming = null; });
    return attempt;
  }
  $("clear-freeze").onclick = clearFrozen;
  $("start-camera").onclick = () => {
    if (!pendingPlayback) return;
    // Reset a stalled element on the user gesture, retaining the granted stream.
    const video = $("video");
    video.pause?.(); video.srcObject = stream; video.load?.();
    return pendingPlayback();
  };
  async function takePhoto() {
    if (!live || saving) return;
    let owner = cameraEpoch;
    try {
      const picture = live.capture();
      stopCamera();
      captured = picture;
      $("camera-panel").hidden = false;
      modal.open();
      markView("captured");
      // The canvas now holds the stored picture, frozen or live before.
      $("live-preview").setAttribute?.("data-view", "captured");
      document.body?.classList.add("camera-open");
      $("close-camera").focus?.();
      $("take-photo").hidden = true;
      $("retake-photo").hidden = false;
      // Without a live reading the picture still goes to the crop editor, so
      // "capture for manual review" is always a real path, not a dead end.
      $("use-live-capture").hidden = false;
      $("use-live-capture").textContent = picture.found
        ? "Review captured clues"
        : "Crop and read in the editor";
      $("download-live-capture").hidden = true;
      $("camera-help").textContent = "Saving this picture on your device…";
      const epoch = cameraEpoch;
      owner = epoch;
      saving = true;
      const saved = await savePicture(picture.annotated, picture.createdAt);
      if (epoch === cameraEpoch) {
        $("download-live-capture").hidden = false;
        $("camera-help").textContent = saved
          ? "Picture saved in this browser. Download PNG to keep a separate copy, or scan another."
          : "The picture could not be stored here. Download the PNG to keep it.";
      }
    } catch (error) {
      if (owner === cameraEpoch) $("camera-help").textContent = error.message || "Could not capture this frame. Please retry.";
    } finally { saving = false; $("take-photo").disabled = false; }
  }
  $("take-photo").onclick = () => void takePhoto();
  $("retake-photo").onclick = openCamera;
  $("use-live-capture").onclick = () => {
    if (!captured) return;
    const picture = captured, found = picture.found;
    if (!found) {
      // No automatic reading was available (paused, blurred or undetected):
      // hand the exact captured frame to the ordinary crop-and-read flow.
      stopTask();
      stopCamera();
      void acceptPhoto(picture.photo);
      return;
    }
    try {
      checkShape(found.puzzle);
      const next = {
        photo: picture.photo, corners: picture.corners,
        puzzle: found.puzzle, play: fitPlay(found.puzzle, []), hints: new Set(),
        uncertain: new Set(found.cellUncertain ?? found.uncertain ?? []),
        blackReadings: fitBlackReadings(found.puzzle, found.blackReadings),
        cageUncertain: new Set(found.cageUncertain ?? []),
        needsReview: true, notes: fitReviewNotes([...found.notes]), rectified: found.rectified,
        photoRows: found.puzzle.rows, photoCols: found.puzzle.cols, selected: [],
      };
      stopTask(); stopCamera(); remember(); invalidate();
      Object.assign(state, next);
      cropRevision = {};
      // Its corners are the live tracker's, which reads only a confident
      // lattice with both axes, at the size it read: confirmed for that size,
      // whatever an earlier photograph's crop was.
      unconfirmedCorners = false;
      detectedLayout = { rows: found.puzzle.rows, cols: found.puzzle.cols };
      // The crop editor may still show an earlier import; this capture is
      // reviewed on the board.
      $("photo-panel").hidden = true;
      setLayout(found.puzzle);
      state.puzzleSource = state.photoSource = getJobId();
      // The stopped camera no longer owns diagnostics. Begin a fresh context
      // for the exact unannotated capture, clearing any earlier image consent.
      diagnostics.begin("photo", { ...found.puzzle, autoSolve: $("auto-solve").checked });
      diagnostics.geometry({ rows: found.puzzle.rows, cols: found.puzzle.cols,
        width: picture.photo.width, height: picture.photo.height,
        coordinateSpace: "source-preview", corners: picture.corners });
      diagnostics.event({ stage: "checking", reason: "read-complete",
        found: { ...found, needsReview: true } });
      persist(); render({ replaceDraft: true });
      warmSolver?.();
      status("Captured clues ready for review.", "The saved picture is unchanged. Confirm the clues and rules before solving or playing.");
    } catch (error) { fail(error); }
  };
  $("choose-photo").onclick = () => $("photo-file").click();
  $("native-camera").onclick = () => $("native-file").click();
  for (const id of ["photo-file", "native-file"])
    $(id).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      stopCamera();
      stopTask();
      const epoch = getJobId();
      try {
        const { image: canvas } = await importPhoto(file, { current: () => epoch === getJobId() });
        if (epoch === getJobId()) await acceptPhoto(canvas);
        else canvas.width = canvas.height = 0;
      } catch (error) {
        if (epoch === getJobId()) fail(error);
      } finally {
        e.target.value = "";
      }
    };
  function drawCrop() {
    if (!state.photo || !state.corners) return;
    const out = $("crop-canvas"),
      ctx = out.getContext("2d");
    out.width = state.photo.width;
    out.height = state.photo.height;
    ctx.drawImage(state.photo, 0, 0);
    const radius = Math.max(15, out.width / 32);
    ctx.beginPath();
    state.corners.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.strokeStyle = "#0cbb94";
    ctx.lineWidth = Math.max(3, out.width / 220);
    ctx.stroke();
    state.corners.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#123b3b";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = radius / 10;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${radius}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i + 1, p.x, p.y);
    });
  }
  function currentLayout() {
    return {
      rows: Number($("rows").value),
      cols: Number($("cols").value),
      boxRows: Number($("box-rows").value),
      boxCols: Number($("box-cols").value),
    };
  }
  function sameLayout(a, b) {
    return a !== null && ["rows", "cols", "boxRows", "boxCols"].every(
      (key) => a[key] === b[key],
    );
  }
  function transposeLayout({ rows, cols, boxRows, boxCols }) {
    return { rows: cols, cols: rows, boxRows: boxCols, boxCols: boxRows };
  }
  async function acceptPhoto(canvas, auto = false) {
    diagnostics.begin("photo", { ...currentLayout(), type: $("puzzle-type").value, autoSolve: $("auto-solve").checked });
    invalidate();
    state.history = [];
    state.puzzleSource = null;
    state.photo = canvas;
    cropRevision = {};
    clearPhotoMapping();
    state.corners = null;
    state.result = null;
    $("photo-panel").hidden = false;
    render();
    await detectPhoto(canvas, auto);
  }
  // Re-detection is not adoption of a new photograph or a puzzle edit. Keep
  // undo history and the old crop/mapping intact until a current result exists.
  async function detectPhoto(canvas, auto = false) {
    const id = begin();
    diagnostics.event({stage:"detecting",reason:"started"});
    status("Finding the grid…", "Photo processing stays on this device.");
    try {
      const found = await scanner.detect(canvas);
      if (id !== getJobId()) return;
      clearPhotoMapping();
      state.corners = found.corners;
      cropRevision = {};
      unconfirmedCorners = !(found.confidence > 0.8);
      detectedLayout = found.rows && found.cols ? { rows: found.rows, cols: found.cols } : null;
      diagnostics.geometry({ ...found, width: canvas.width, height: canvas.height, coordinateSpace: "source-preview" });
      diagnostics.event({stage:"detecting",reason:found.confidence > .8 ? "found" : "manual-corners"});
      finish();
      if (found.rows && found.cols) {
        const layout = currentLayout(),
          { boxRows, boxCols } = layout;
        // Grid detection measures cells, not Sudoku box orientation. Keep a
        // compatible chosen layout, including when Find grid runs again.
        if (
          layout.rows === found.rows && layout.cols === found.cols &&
          Number.isInteger(boxRows) && Number.isInteger(boxCols) &&
          boxRows > 0 && boxCols > 0 && boxRows * boxCols === found.rows &&
          found.rows % boxRows === 0 && found.cols % boxCols === 0
        )
          setLayout(layout);
        else {
          const [boxRows, boxCols] = boxDefault(found.rows);
          proposedBoxLayout = { rows: found.rows, cols: found.cols, boxRows, boxCols };
          setLayout(proposedBoxLayout);
        }
      }
      drawCrop();
      status(
        found.confidence > 0.8 ? "Grid found." : "Set the four crop corners.",
        found.rows
          ? `Detected ${found.rows} × ${found.cols}. Check the corners, then read the puzzle.`
          : "Drag the numbered handles. Set rows and columns in Grid size & settings.",
      );
      $("photo-panel").scrollIntoView({ block: "start", behavior: "smooth" });
      if (auto && found.confidence > 0.85) await readPhoto();
    } catch (e) {
      if (id === getJobId()) {
        finish();
        diagnostics.event({stage:"error",reason:"failed"});
        fail(e);
      }
    }
  }
  $("detect-photo").onclick = () => {
    if (state.photo) return detectPhoto(state.photo);
  };
  $("rotate-photo").onclick = () => {
    if (!state.photo) return;
    const c = document.createElement("canvas");
    c.width = state.photo.height;
    c.height = state.photo.width;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(state.photo, 0, 0);
    rotatePhotoSource(state.photo, c);
    // A quarter-turn swaps the box orientation as well as the grid axes.
    setLayout(transposeLayout(currentLayout()));
    if (proposedBoxLayout)
      proposedBoxLayout = transposeLayout(proposedBoxLayout);
    void acceptPhoto(c);
  };
  $("hide-photo").onclick = () => ($("photo-panel").hidden = true);
  $("show-crop").onclick = () => {
    $("photo-panel").hidden = false;
    drawCrop();
    $("photo-panel").scrollIntoView({ block: "start", behavior: "smooth" });
  };
  $("crop-canvas").style.maxHeight = "none";
  $("crop-canvas").tabIndex = 0;
  $("crop-canvas").title =
    "Drag corners, or press 1–4 to select a corner and use arrow keys.";
  function cropPoint(e) {
    const b = $("crop-canvas").getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) * $("crop-canvas").width) / b.width,
      y: ((e.clientY - b.top) * $("crop-canvas").height) / b.height,
    };
  }
  $("crop-canvas").onpointerdown = (e) => {
    if (!state.corners) return;
    const pt = cropPoint(e),
      dist = state.corners.map((p) => Math.hypot(p.x - pt.x, p.y - pt.y));
    drag = dist.indexOf(Math.min(...dist));
    if (dist[drag] > state.photo.width * 0.15) {
      drag = -1;
      return;
    }
    stopTask();
    $("crop-canvas").setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  $("crop-canvas").onpointermove = (e) => {
    if (drag < 0) return;
    const pt = cropPoint(e);
    state.corners[drag] = {
      x: Math.max(0, Math.min(state.photo.width - 1, pt.x)),
      y: Math.max(0, Math.min(state.photo.height - 1, pt.y)),
    };
    unconfirmedCorners = false;
    cropRevision = {};
    detectedLayout = null;
    clearPhotoMapping();
    drawCrop();
  };
  $("crop-canvas").onpointerup = $("crop-canvas").onpointercancel = () => {
    drag = -1;
  };
  let keyboardCorner = 0;
  $("crop-canvas").onkeydown = (e) => {
    if (!state.corners) return;
    if (/^[1-4]$/.test(e.key)) {
      keyboardCorner = Number(e.key) - 1;
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[e.key];
    if (delta) {
      e.preventDefault();
      stopTask();
      const p = state.corners[keyboardCorner],
        step = e.shiftKey ? 10 : 1;
      p.x = Math.max(0, Math.min(state.photo.width - 1, p.x + delta[0] * step));
      p.y = Math.max(
        0,
        Math.min(state.photo.height - 1, p.y + delta[1] * step),
      );
      unconfirmedCorners = false;
      cropRevision = {};
      detectedLayout = null;
      clearPhotoMapping();
      drawCrop();
    }
  };
  async function readPhoto() {
    if (!state.photo || !state.corners) return;
    // A new Read owns the next outcome even when its settings are invalid.
    // Supersede earlier OCR before preflight, just as a new import does.
    stopTask();
    drag = -1;
    const rows = Number($("rows").value),
      cols = Number($("cols").value),
      type = $("puzzle-type").value;
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      rows < 1 ||
      cols < 1 ||
      rows > 25 ||
      cols > 25
    ) {
      fail(Error("Set rows and columns to whole numbers from 1 to 25."));
      return;
    }
    if (!validQuad(state.corners, state.photo.width, state.photo.height)) {
      fail(
        Error(
          "The crop corners must surround the grid clockwise without crossing.",
        ),
      );
      return;
    }
    const boxRows = Number($("box-rows").value),
      boxCols = Number($("box-cols").value),
      // Snapshot proposal ownership with the rules, before awaiting OCR.
      reviewBoxes = sameLayout(proposedBoxLayout, { rows, cols, boxRows, boxCols }),
      // Likewise the crop's standing: a reading from corners nobody confirmed
      // (the grid was not found and the handles were never moved) can hold
      // wrong, invented or missing clues anywhere, so every cell is reviewed.
      // So can a reading at another size through the untouched corners of a
      // lattice the detector found: they need not bound this grid.
      resized = !unconfirmedCorners && detectedLayout &&
        (rows !== detectedLayout.rows || cols !== detectedLayout.cols) ? { ...detectedLayout } : null,
      reviewAllCells = unconfirmedCorners || Boolean(resized);
    try {
      if (type !== "auto") {
        const layout = makePuzzle(type, rows, cols);
        // Hidden box controls belong only to boxed families. An incomplete
        // Sudoku setting must not block a later Futoshiki/Kakuro/etc. read.
        if (["sudoku", "killersudoku"].includes(type)) {
          layout.boxRows = boxRows;
          layout.boxCols = boxCols;
        }
        checkShape(layout);
      }
    } catch (error) {
      fail(error);
      return;
    }
    diagnostics.configure({ type, rows, cols, boxRows, boxCols, autoSolve: $("auto-solve").checked });
    diagnostics.geometry({ rows, cols, corners: state.corners, width: state.photo.width, height: state.photo.height, coordinateSpace: "source-preview" });
    // Keep the accepted board, solution and still-valid photo mapping until
    // a complete replacement is ready. Crop edits already invalidate mapping.
    const id = begin();
    setDeadline(() => {
      if (id === getJobId())
        stopTask(
          "Recognition timed out. Check the connection and try a clearer photograph.",
        );
    }, 120000);
    try {
      const photograph = state.photo, corners = state.corners.map((p) => ({ ...p })),
        detail = hasPhotoSource(photograph)
          ? await photoDetail(photograph, corners, { current: () => id === getJobId() })
          : { image: photograph, corners, release() {} };
      let found;
      try {
        if (id !== getJobId()) return;
        found = await scanner.read(detail.image, detail.corners, type, rows, cols,
          (text, p) => { if (id === getJobId()) status(text, "", "info", p); },
          {onDiagnostic:event => { if (id === getJobId()) diagnostics.event(event); }});
        if (detail.note) found.notes = [...found.notes, detail.note];
      } finally { detail.release(); }
      if (id !== getJobId()) return;
      // Snapshot settings belong to this scan. Validate the complete candidate
      // before committing history, state or autosave, including automatic type.
      // Automatic quarter-turns rotate the grid axes, not just the clue
      // positions. Rectangular boxes must follow the crop into that frame.
      const quarterTurn = found.turns % 2 === 1,
        readLayout = quarterTurn
          ? transposeLayout({ rows, cols, boxRows, boxCols })
          : { rows, cols, boxRows, boxCols };
      if (["sudoku", "killersudoku"].includes(found.puzzle.type)) {
        found.puzzle.boxRows = readLayout.boxRows;
        found.puzzle.boxCols = readLayout.boxCols;
      }
      checkShape(found.puzzle);
      const blackReadings = fitBlackReadings(found.puzzle, found.blackReadings),
        needsBoxReview = reviewBoxes &&
          ["sudoku", "killersudoku"].includes(found.puzzle.type),
        notes = [...found.notes];
      if (reviewAllCells)
        notes.unshift(resized
          ? `The grid was found with ${resized.rows} × ${resized.cols} cells and read as ${rows} × ${cols} through the same corners, so every cell is highlighted. Adjust the corners onto the grid's outer edge (moving any corner confirms them, even if they already sit there) and read again, or check each cell against the photograph.`
          : "The grid was not found automatically and the crop corners were not adjusted, so every cell is highlighted. Set the corners on the grid and read again, or check each cell against the photograph.",
        );
      if (needsBoxReview)
        notes.push(
          `Box layout ${readLayout.boxRows} rows × ${readLayout.boxCols} columns was suggested from the grid size, not read from the photograph. Confirm it before solving.`,
        );
      // Prepare every editable field before touching history or accepted state.
      const next = {
        puzzle: found.puzzle,
        result: null,
        solution: 0,
        view: "board",
        play: fitPlay(found.puzzle, []),
        hints: new Set(),
        playFeedback: null,
        playSolution: null,
        blackReadings,
        uncertain: new Set([
          ...(found.cellUncertain ?? found.uncertain),
          ...blackReadings.map((entry) => entry.cell),
          ...(reviewAllCells ? found.puzzle.cells.keys() : []),
        ]),
        cageUncertain: new Set(found.cageUncertain || []),
        needsReview: found.needsReview || needsBoxReview || reviewAllCells,
        notes: fitReviewNotes(notes),
        rectified: found.rectified,
        // A reading taken turned (see Scanner.orient) keeps the crop in step,
        // so handle 1 is the grid's top-left and the photo mapping holds.
        ...(found.turns ? { corners: turnCorners(corners, found.turns) } : {}),
        puzzleSource: id,
        photoSource: id,
        photoRows: rows,
        photoCols: cols,
        selected: [],
      };
      finish();
      rememberPhotoRead();
      clearPhotoMapping();
      Object.assign(state, next);
      if (quarterTurn) {
        // Commit the controls and proposal only with the validated reading,
        // after the undo snapshot. A repeat Read uses the rotated layout and
        // still asks for confirmation of boxes suggested by detection.
        setLayout(readLayout);
        if (proposedBoxLayout)
          proposedBoxLayout = transposeLayout(proposedBoxLayout);
      }
      diagnostics.event({stage:"checking",reason:"read-complete",found});
      persist();
      render({ replaceDraft: true });
      $("photo-panel").hidden = true;
      warmSolver?.();
      status(
        "Puzzle read.",
        `${type === "auto" ? `${TYPES[state.puzzle.type]} suggested` : TYPES[state.puzzle.type]}. Check highlighted cells and the puzzle rules.`,
      );
      $("board-title").scrollIntoView({ behavior: "smooth", block: "start" });
      if (
        $("auto-solve").checked &&
        !state.uncertain.size &&
        !state.cageUncertain.size &&
        !state.needsReview &&
        state.puzzle.cells.some(Number.isInteger)
      )
        solveNow();
    } catch (e) {
      if (id === getJobId()) {
        finish();
        diagnostics.event({stage:"error",reason:"failed"});
        fail(e);
      }
    }
  }
  $("read-photo").onclick = () => void readPhoto();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    // A frozen solution stays on screen with its reading, and Save picture
    // still keeps it, but its camera is turned off; Clear asks for it again.
    if (live?.view === "frozen") { if (stream) releaseStream("hidden"); return; }
    // Release the camera when the page is hidden. A captured still holds no
    // camera resource, and its review path must survive an app switch, the
    // lock screen or a download prompt.
    if (!(captured && !stream && !live)) stopCamera();
  });

  return { stopCamera };
}
