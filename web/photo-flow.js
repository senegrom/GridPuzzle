import { TYPES, checkShape, makePuzzle } from "./model.js";
import { validQuad } from "./geometry.js";

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
  getJobId,
  setDeadline,
}) {
  let stream = null,
    cameraEpoch = 0,
    drag = -1;
  function stopCamera() {
    cameraEpoch++;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    $("video").srcObject = null;
    $("camera-panel").hidden = true;
  }
  function frame(video, max = 1600) {
    if (!video.videoWidth) throw Error("The camera is not ready yet.");
    const scale = Math.min(
        1,
        max / Math.max(video.videoWidth, video.videoHeight),
      ),
      c = document.createElement("canvas");
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  async function openCamera() {
    stopTask();
    stopCamera();
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
      $("video").srcObject = stream;
      await $("video").play();
      $("camera-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      status("Camera ready.", "Capture manually or hold a clear grid steady.");
      let stable = 0,
        previous = null;
      const loop = async () => {
        if (epoch !== cameraEpoch || !stream) return;
        try {
          if ($("auto-capture").checked) {
            const small = frame($("video"), 480),
              found = await scanner.detect(small);
            if (epoch !== cameraEpoch) return;
            const movement = previous
              ? Math.max(
                  ...found.corners.map((p, i) =>
                    Math.hypot(
                      p.x - previous.corners[i].x,
                      p.y - previous.corners[i].y,
                    ),
                  ),
                )
              : Infinity;
            if (
              found.confidence > 0.85 &&
              found.sharpness > 100 &&
              movement < small.width * 0.018 &&
              found.rows === previous?.rows &&
              found.cols === previous?.cols
            )
              stable++;
            else stable = 0;
            previous = found;
            $("camera-help").textContent = stable
              ? `Grid found. Hold steady… ${stable}/3`
              : "Keep the entire grid in view. Hold steady or tap Capture.";
            if (stable >= 3) {
              takePhoto(true);
              return;
            }
          }
        } catch (error) {
          if (error.name !== "AbortError")
            $("camera-help").textContent =
              "Automatic capture is unavailable. Tap Capture to continue.";
        }
        if (epoch === cameraEpoch) setTimeout(loop, 800);
      };
      setTimeout(loop, 900);
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
  function takePhoto(auto = false) {
    try {
      const canvas = frame($("video"));
      stopCamera();
      void acceptPhoto(canvas, auto);
    } catch (e) {
      fail(e);
    }
  }
  $("take-photo").onclick = () => takePhoto();
  $("choose-photo").onclick = () => $("photo-file").click();
  $("native-camera").onclick = () => $("native-file").click();
  const MAX_SIDE = 1600,
    JPEG_FRAME_MARKERS = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
  // Stored pixel dimensions from a PNG header or the first JPEG frame header;
  // null for other formats. Orientation metadata is not applied here.
  function sniffDimensions(bytes) {
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      if (JPEG_FRAME_MARKERS.has(marker))
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
        };
      i += 2 + length;
    }
    return null;
  }
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
    c.getContext("2d").drawImage(source, 0, 0, width, height);
    return c;
  }
  async function decodeFile(file) {
    if (file.size > 30 * 1024 * 1024)
      throw Error("Please choose a photo smaller than 30 MB.");
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer()),
      dimensions = sniffDimensions(head),
      pixels = dimensions ? dimensions.width * dimensions.height : null;
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
    if (pixels > 24e6 || (!dimensions && file.size > 10 * 1024 * 1024))
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
        fail(error);
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
    const id = begin();
    status("Finding the grid…", "Photo processing stays on this device.");
    try {
      const found = await scanner.detect(canvas);
      if (id !== getJobId()) return;
      state.corners = found.corners;
      finish();
      if (found.rows && found.cols) {
        $("rows").value = found.rows;
        $("cols").value = found.cols;
        const b = boxDefault(found.rows);
        $("box-rows").value = b[0];
        $("box-cols").value = b[1];
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
    if (state.photo) void acceptPhoto(state.photo);
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
      boxCols = Number($("box-cols").value);
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
    clearPhotoMapping();
    state.result = null;
    $("next-solution").hidden = true;
    drawBoard();
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
      finish();
      remember();
      state.puzzle = found.puzzle;
      state.uncertain = new Set(found.uncertain);
      state.needsReview = found.needsReview;
      state.notes = found.notes;
      state.rectified = found.rectified;
      state.puzzleSource = state.photoSource = id;
      state.photoRows = rows;
      state.photoCols = cols;
      state.selected = [];
      persist();
      render();
      $("photo-panel").hidden = true;
      status(
        "Puzzle read.",
        `${type === "auto" ? `${TYPES[state.puzzle.type]} suggested` : TYPES[state.puzzle.type]}. Check highlighted cells and the puzzle rules.`,
      );
      $("board-title").scrollIntoView({ behavior: "smooth", block: "start" });
      if (
        $("auto-solve").checked &&
        !state.uncertain.size &&
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
