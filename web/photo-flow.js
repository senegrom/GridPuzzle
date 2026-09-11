import { TYPES, checkShape, fitPlay, fitBlackReadings, makePuzzle } from "./model.js";
import { validQuad } from "./geometry.js";
import { sniffDimensions } from "./image-dimensions.js";
import { createLiveCamera } from "./live-camera.js";

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
  liveFactory = createLiveCamera,
}) {
  let stream = null,
    cameraEpoch = 0,
    drag = -1,
    proposedBoxLayout = null,
    live = null,
    pendingPlayback = null,
    playbackTimer = null,
    captured = null,
    saving = false;
  function stopCamera() {
    cameraEpoch++;
    live?.stop();
    live = null;
    pendingPlayback = null;
    clearTimeout(playbackTimer); playbackTimer = null;
    $("start-camera").hidden = true;
    document.body?.classList.remove("camera-open");
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    $("video").srcObject = null;
    $("camera-panel").hidden = true;
  }
  async function openCamera() {
    stopTask();
    stopCamera();
    releaseSolver?.();
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
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (epoch !== cameraEpoch) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = acquired;
      $("camera-panel").hidden = false;
      // Set the properties as well as the HTML attributes before assigning a
      // MediaStream. WebKit can require explicit muted inline playback.
      const video = $("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      document.body?.classList.add("camera-open");
      const startPreview = async () => {
        if (epoch !== cameraEpoch || live) return;
        $("start-camera").disabled = true;
        try {
          // A playback promise can remain pending when a browser has connected
          // a stream but received no frame. Offer a recoverable explicit retry.
          await Promise.race([
            video.play(),
            new Promise((_, reject) => {
              playbackTimer = setTimeout(() => reject(Object.assign(
                Error("No camera frame arrived. Tap Start preview to retry."),
                { name: "PreviewTimeout" },
              )), 8000);
            }),
          ]);
          if (epoch !== cameraEpoch) return;
          pendingPlayback = null;
          $("start-camera").hidden = true;
          status("Camera ready.", "Hold a clear grid steady; the shutter saves the view.");
          live = liveFactory({ $, video, canvas: $("live-preview"),
            getSettings: () => ({
              type: $("puzzle-type").value,
              rows: Number($("rows").value), cols: Number($("cols").value),
              boxRows: Number($("box-rows").value), boxCols: Number($("box-cols").value),
              enabled: $("auto-capture").checked,
            }),
          });
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
          if (epoch === cameraEpoch) {
            clearTimeout(playbackTimer); playbackTimer = null;
            $("start-camera").disabled = false;
          }
        }
      };
      pendingPlayback = startPreview;
      await startPreview();
      if (epoch !== cameraEpoch) return;
      for (const track of acquired.getTracks())
        track.addEventListener?.("ended", () => {
          if (epoch === cameraEpoch) { stopCamera(); status("Camera disconnected.", "Your saved pictures and puzzle are unchanged.", "warning"); }
        }, { once: true });
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
  $("close-camera").onclick = stopCamera;
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
      document.body?.classList.add("camera-open");
      $("take-photo").hidden = true;
      $("retake-photo").hidden = false;
      $("use-live-capture").hidden = !picture.found;
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
    if (!captured?.found) return;
    const picture = captured, found = picture.found;
    try {
      checkShape(found.puzzle);
      const next = {
        photo: picture.photo, corners: picture.corners,
        puzzle: found.puzzle, play: fitPlay(found.puzzle, []), hints: new Set(),
        uncertain: new Set(found.cellUncertain ?? found.uncertain ?? []),
        blackReadings: fitBlackReadings(found.puzzle, found.blackReadings),
        cageUncertain: new Set(found.cageUncertain ?? []),
        needsReview: true, notes: [...found.notes], rectified: found.rectified,
        photoRows: found.puzzle.rows, photoCols: found.puzzle.cols, selected: [],
      };
      stopTask(); stopCamera(); remember(); invalidate();
      Object.assign(state, next);
      setLayout(found.puzzle);
      state.puzzleSource = state.photoSource = getJobId();
      persist(); render({ replaceDraft: true });
      status("Captured clues ready for review.", "The saved picture is unchanged. Confirm the clues and rules before solving or playing.");
    } catch (error) { fail(error); }
  };
  $("choose-photo").onclick = () => $("photo-file").click();
  $("native-camera").onclick = () => $("native-file").click();
  const MAX_SIDE = 1600;
  function fit(width, height) {
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    return [
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    ];
  }
  function draw(source, width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    // Geometry and OCR consume RGB. Transparent PNG backgrounds should behave
    // like white paper in both the ImageBitmap and Image decode paths.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return c;
  }
  async function decodeFile(file) {
    if (file.size > 30 * 1024 * 1024)
      throw Error("Please choose a photo smaller than 30 MB.");
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer()),
      dimensions = sniffDimensions(head, file.size);
    if (!dimensions)
      throw Error("The photo dimensions could not be checked safely. Export it as JPEG, PNG or WebP, then try again.");
    const pixels = dimensions.width * dimensions.height;
    if (dimensions && (dimensions.width < 1 || dimensions.height < 1))
      throw Error("The image is empty.");
    if (pixels > 120e6)
      throw Error(
        "This photo is too large to decode safely on a phone. Use a smaller camera resolution or crop it first.",
      );
    if (dimensions && typeof createImageBitmap === "function") {
      // Decode straight to the working size instead of materializing a
      // full-resolution phone photograph. Only one side is requested so the
      // aspect ratio survives EXIF rotation; the final fit happens on canvas.
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(file, {
          resizeWidth: fit(dimensions.width, dimensions.height)[0],
          resizeQuality: "high",
          imageOrientation: "from-image",
        });
      } catch {
        bitmap = null;
      }
      if (bitmap)
        try {
          return draw(bitmap, ...fit(bitmap.width, bitmap.height));
        } finally {
          bitmap.close?.();
        }
    }
    // A full decode is the only remaining route; refuse sizes that can
    // exhaust phone memory instead of crashing the page.
    if (pixels > 24e6)
      throw Error(
        "This browser cannot downscale this large photo safely. Crop it in your photo app first, then try again.",
      );
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight)
        throw Error("The image is empty.");
      return draw(img, ...fit(img.naturalWidth, img.naturalHeight));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  for (const id of ["photo-file", "native-file"])
    $(id).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      stopCamera();
      stopTask();
      const epoch = getJobId();
      try {
        const canvas = await decodeFile(file);
        if (epoch === getJobId()) await acceptPhoto(canvas);
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
    invalidate();
    state.history = [];
    state.puzzleSource = null;
    state.photo = canvas;
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
    status("Finding the grid…", "Photo processing stays on this device.");
    try {
      const found = await scanner.detect(canvas);
      if (id !== getJobId()) return;
      clearPhotoMapping();
      state.corners = found.corners;
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
      reviewBoxes = sameLayout(proposedBoxLayout, { rows, cols, boxRows, boxCols });
    try {
      if (type !== "auto") {
        const layout = makePuzzle(type, rows, cols);
        layout.boxRows = boxRows;
        layout.boxCols = boxCols;
        checkShape(layout);
      }
    } catch (error) {
      fail(error);
      return;
    }
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
      const found = await scanner.read(
        state.photo,
        state.corners,
        type,
        rows,
        cols,
        (text, p) => {
          if (id === getJobId()) status(text, "", "info", p);
        },
      );
      if (id !== getJobId()) return;
      // Snapshot settings belong to this scan. Validate the complete candidate
      // before committing history, state or autosave, including automatic type.
      if (["sudoku", "killersudoku"].includes(found.puzzle.type)) {
        found.puzzle.boxRows = boxRows;
        found.puzzle.boxCols = boxCols;
      }
      checkShape(found.puzzle);
      const blackReadings = fitBlackReadings(found.puzzle, found.blackReadings),
        needsBoxReview = reviewBoxes &&
          ["sudoku", "killersudoku"].includes(found.puzzle.type),
        notes = [...found.notes];
      if (needsBoxReview)
        notes.push(
          `Box layout ${boxRows} rows × ${boxCols} columns was suggested from the grid size, not read from the photograph. Confirm it before solving.`,
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
        ]),
        cageUncertain: new Set(found.cageUncertain || []),
        needsReview: found.needsReview || needsBoxReview,
        notes,
        rectified: found.rectified,
        puzzleSource: id,
        photoSource: id,
        photoRows: rows,
        photoCols: cols,
        selected: [],
      };
      finish();
      remember();
      clearPhotoMapping();
      Object.assign(state, next);
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
        fail(e);
      }
    }
  }
  $("read-photo").onclick = () => void readPhoto();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
  });

  return { stopCamera };
}
