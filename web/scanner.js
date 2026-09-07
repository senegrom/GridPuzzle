import { makePuzzle, classify, conflicts, isCage } from "./model.js";
import { mapAtlas, atlasLayout } from "./ocr-map.js";
const aborted = () => new DOMException("Scan cancelled", "AbortError");
export function imageOf(canvas) {
  return canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
}
export function canvasOf(image) {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d").putImageData(
    new ImageData(image.data, image.width, image.height),
    0,
    0,
  );
  return c;
}
function fraction(mask, w, h, x, y, rw, rh) {
  let sum = 0,
    n = 0;
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) {
      sum += mask[yy * w + xx];
      n++;
    }
  return sum / Math.max(1, n);
}
function componentsForCages(mask, w, h, rows, cols, type) {
  const cw = w / cols,
    ch = h / rows,
    parent = Array.from({ length: rows * cols }, (_, i) => i),
    root = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
  function boundary(r, c, vertical) {
    const x = vertical ? (c + 1) * cw : c * cw + 0.2 * cw,
      y = vertical ? r * ch + 0.2 * ch : (r + 1) * ch;
    const band = Math.max(1, Math.min(cw, ch) * 0.023),
      offset = Math.min(cw, ch) * 0.075;
    const strip = (d) =>
      vertical
        ? fraction(mask, w, h, x + d - band / 2, y, band, ch * 0.6)
        : fraction(mask, w, h, x, y + d - band / 2, cw * 0.6, band);
    if (type === "killersudoku")
      return Math.max(strip(-offset), strip(offset)) > 0.19;
    return Math.min(strip(-band * 1.2), strip(band * 1.2)) > 0.3;
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1 && !boundary(r, c, true)) parent[root(i)] = root(i + 1);
      if (r < rows - 1 && !boundary(r, c, false))
        parent[root(i)] = root(i + cols);
    }
  const groups = new Map();
  for (let i = 0; i < parent.length; i++) {
    const k = root(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return [...groups.values()];
}
export class Scanner {
  constructor() {
    this.epoch = 0;
    this.jobs = new Set();
  }
  cancel() {
    this.epoch++;
    for (const job of this.jobs) job.cancel();
    this.jobs.clear();
  }
  _request(path, payload, onProgress = () => {}, type = "module") {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(path, import.meta.url), { type });
      let settled = false;
      const end = (error, result, cancel = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.jobs.delete(job);
        worker.onmessage = worker.onerror = null;
        if (cancel && type === "classic") {
          // The host can terminate its raw child even while createWorker is
          // still awaiting engine/language initialization. Bound host cleanup
          // too, including a stalled importScripts before any child exists.
          const kill = setTimeout(() => worker.terminate(), 100);
          worker.onmessage = ({ data }) => {
            if (!data?.cancelled) return; // Ignore progress queued before Stop.
            clearTimeout(kill);
            worker.terminate();
          };
          try {
            worker.postMessage({ cancel: true });
          } catch {
            clearTimeout(kill);
            worker.terminate();
          }
        } else worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const job = { cancel: () => end(aborted(), null, true) };
      const timeout = setTimeout(
        () =>
          end(
            Error("Image processing timed out. Go online and retry."),
            null,
            true,
          ),
        180000,
      );
      this.jobs.add(job);
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          onProgress(data.message, data.progress);
          return;
        }
        end(data.error ? Error(data.error) : null, data.result);
      };
      worker.onerror = (e) =>
        end(Error(e.message || "Image processing failed"), null, true);
      try {
        worker.postMessage(payload);
      } catch (error) {
        end(error, null, true);
      }
    });
  }
  geometry(op, options) {
    return this._request("geometry-worker.js", { op, ...options });
  }
  detect(canvas) {
    return this.geometry("detect", { image: imageOf(canvas) });
  }
  async read(canvas, corners, type, rows, cols, onProgress = () => {}) {
    this.cancel();
    const epoch = this.epoch,
      check = () => {
        if (epoch !== this.epoch) throw aborted();
      };
    onProgress("Straightening the photograph…", null);
    const { image, meta, mask, g, black, entries } = await this.geometry(
      "prepare",
      {
        image: imageOf(canvas),
        corners,
        width: Math.min(1500, cols * 100),
        height: Math.min(1500, rows * 100),
        type,
        rows,
        cols,
      },
    );
    check();
    const w = image.width,
      h = image.height,
      cw = w / cols,
      ch = h / rows,
      rectified = canvasOf(image);
    if (!entries.length)
      throw Error(
        "No printed clues found. Adjust the crop, dimensions or lighting.",
      );
    // One bounded atlas call, not separate OCR calls for every cell. The
    // sparse-text mode and character boxes preserve the original clue slots.
    const { tile, columns, rows: atlasRows } = atlasLayout(entries.length),
      atlas = document.createElement("canvas");
    atlas.width = columns * tile;
    atlas.height = atlasRows * tile;
    const ctx = atlas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, atlas.width, atlas.height);
    const bw = canvasOf({
        width: w,
        height: h,
        data: new Uint8ClampedArray(image.data.length),
      }),
      bd = bw.getContext("2d").createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 0 : 255;
      bd.data[4 * i] = bd.data[4 * i + 1] = bd.data[4 * i + 2] = v;
      bd.data[4 * i + 3] = 255;
    }
    bw.getContext("2d").putImageData(bd, 0, 0);
    entries.forEach((e, i) => {
      const scale = Math.min((tile * 74) / 112 / e.w, (tile * 72) / 112 / e.h),
        dw = e.w * scale,
        dh = e.h * scale,
        x = (i % columns) * tile + (tile - dw) / 2,
        y = Math.floor(i / columns) * tile + (tile - dh) / 2;
      ctx.save();
      if (e.invert) ctx.filter = "invert(1)";
      ctx.drawImage(
        e.invert ? rectified : bw,
        e.x,
        e.y,
        e.w,
        e.h,
        x,
        y,
        dw,
        dh,
      );
      ctx.restore();
    });
    onProgress("Loading printed-clue recognition…", null);
    const blob = await new Promise((resolve, reject) =>
      atlas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(Error("Could not encode the OCR atlas.")),
        "image/png",
      ),
    );
    check();
    const png = await blob.arrayBuffer();
    check();
    const data = await this._request(
      "ocr-host-worker.js",
      { png },
      onProgress,
      "classic",
    );
    check();
    const readings = mapAtlas(data, entries.length, columns, tile);
    entries.forEach((e, i) => {
      e.text = readings[i].text;
      e.confidence = readings[i].confidence;
    });
    const valueEntries = entries.filter((e) => ["value", "blackvalue"].includes(e.kind)),
      values = Array(rows * cols).fill(null),
      blackValueCells = new Set(),
      uncertain = new Set();
    for (const e of valueEntries) {
      if (/^\d{1,3}$/.test(e.text)) values[e.cell] = +e.text;
      if (e.kind === "blackvalue" && values[e.cell] !== null) blackValueCells.add(e.cell);
      if (values[e.cell] === null || e.confidence < 85) uncertain.add(e.cell);
    }
    const labels = entries.filter(
      (e) => e.kind === "label" && /^\d{1,12}[+\-xX*\/÷×=]?$/.test(e.text),
    );
    const signs = entries.filter(
      (e) => ["hsign", "vsign"].includes(e.kind) && /^[<>^vV]$/.test(e.text),
    );
    const triangles = entries.filter(
      (e) => ["across", "down"].includes(e.kind) && /^\d{1,2}$/.test(e.text),
    );
    const suggested = classify({
      rows,
      cols,
      values,
      signs: signs.length,
      labels: labels.length,
      operators: labels.filter((e) => /[+\-xX*\/÷×=]/.test(e.text)).length,
      black: black.filter(Boolean).length,
      blackNumbers: blackValueCells.size,
      triangles: triangles.length,
      boxes: meta.boxes,
      dots: !meta.rows && !meta.cols,
    });
    const chosen = type === "auto" ? suggested.type : type,
      puzzle = makePuzzle(chosen, rows, cols),
      notes = [];
    const max =
      chosen === "slitherlink"
        ? 4
        : ["hidato", "numbrix"].includes(chosen)
          ? rows * cols -
            (chosen === "hidato" ? black.filter(Boolean).length : 0)
          : chosen === "kakuro"
            ? 9
            : rows;
    if (chosen === "str8ts") puzzle.black = black.flatMap((v, i) => v ? [i] : []);
    puzzle.cells = values.map((v, i) => {
      if (black[i] && chosen === "str8ts") { uncertain.add(i); return v === null ? "#" : v; }
      if (black[i] && ["hidato", "kakuro"].includes(chosen)) return "#";
      if (v !== null && (v > max || v < (chosen === "slitherlink" ? 0 : 1))) {
        uncertain.add(i);
        return null;
      }
      return v;
    });
    if (chosen === "futoshiki")
      puzzle.inequalities = signs.map((e) => {
        const smallerFirst = ["<", "^"].includes(e.text);
        uncertain.add(e.cell);
        return {
          less: smallerFirst ? e.cell : e.other,
          greater: smallerFirst ? e.other : e.cell,
        };
      });
    if (chosen === "kakuro") {
      for (let i = 0; i < puzzle.cells.length; i++)
        if (puzzle.cells[i] === "#") {
          const clue = { cell: i };
          for (const d of ["across", "down"]) {
            const e = triangles.find((e) => e.cell === i && e.kind === d);
            if (e) clue[d] = +e.text;
          }
          if (clue.across || clue.down) puzzle.clues.push(clue);
          uncertain.add(i);
        }
    }
    if (isCage(chosen)) {
      const areas = componentsForCages(mask, w, h, rows, cols, chosen);
      puzzle.cages = areas.map((cells) => {
        const matches = labels
            .filter((e) => cells.includes(e.cell))
            .sort((a, b) => a.cell - b.cell),
          text = matches[0]?.text || "",
          target = Number.parseInt(text, 10),
          op =
            chosen === "killersudoku"
              ? "+"
              : text.match(/[+\-xX*\/÷×=]/)?.[0] || "+";
        if (matches.length !== 1)
          notes.push(
            `A cage covering ${cells.length} cells needs its boundary/target checked.`,
          );
        cells.forEach((i) => uncertain.add(i));
        return {
          cells,
          target: Number.isFinite(target) ? target : null,
          op: op.replace(/[xX×]/, "*").replace("÷", "/"),
        };
      });
    }
    conflicts(puzzle).forEach((i) => uncertain.add(i));
    const needsReview =
      (type === "auto" && suggested.review) ||
      isCage(chosen) ||
      ["futoshiki", "kakuro", "hidato", "numbrix", "slitherlink", "str8ts"].includes(
        chosen,
      );
    if (type === "auto") notes.unshift(suggested.reason);
    if (isCage(chosen))
      notes.unshift(
        "Cage recognition is experimental. Check the entire partition: missing boundaries can merge cages.",
      );
    if (chosen === "str8ts") notes.unshift("Str8ts black cells may be blank or numbered; check every black cell before solving.");
    return {
      puzzle,
      uncertain: [...uncertain],
      needsReview,
      notes: [...new Set(notes)].slice(0, 8),
      rectified,
      entries,
    };
  }
}
