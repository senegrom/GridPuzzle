import { makePuzzle, classify, conflicts, isCage } from "./model.js";
import { mapAtlas, atlasLayout, voteDigit } from "./ocr-map.js";
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
function otsuThreshold(g, width, x, y, w, h) {
  const histogram = new Uint32Array(256);
  let total = 0,
    sum = 0;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const value = g[yy * width + xx];
      histogram[value]++;
      total++;
      sum += value;
    }
  let background = 0,
    backgroundSum = 0,
    best = -1,
    threshold = 127;
  for (let value = 0; value < 256; value++) {
    background += histogram[value];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / background,
      meanForeground = (sum - backgroundSum) / foreground,
      score = background * foreground * (meanBackground - meanForeground) ** 2;
    if (score > best) {
      best = score;
      threshold = value;
    }
  }
  return threshold;
}
export function digitCrop(entry, g, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05)),
    row = Math.floor(entry.cell / cols),
    col = entry.cell % cols,
    minX = Math.max(0, Math.round((col + 0.08) * cellWidth)),
    maxX = Math.min(imageWidth, Math.round((col + 0.92) * cellWidth)),
    minY = Math.max(0, Math.round((row + 0.08) * cellHeight)),
    maxY = Math.min(imageHeight, Math.round((row + 0.92) * cellHeight)),
    x = Math.max(minX, entry.x - pad),
    y = Math.max(minY, entry.y - pad),
    right = Math.min(maxX, entry.x + entry.w + pad),
    bottom = Math.min(maxY, entry.y + entry.h + pad),
    width = Math.max(1, right - x),
    height = Math.max(1, bottom - y),
    threshold = otsuThreshold(g, imageWidth, x, y, width, height),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d"),
    pixels = context.createImageData(width, height);
  for (let yy = 0; yy < height; yy++)
    for (let xx = 0; xx < width; xx++) {
      const source = g[(y + yy) * imageWidth + x + xx],
        foreground = entry.invert ? source > threshold : source <= threshold,
        value = foreground ? 0 : 255,
        at = 4 * (yy * width + xx);
      pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = value;
      pixels.data[at + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
const SAMPLE_HEIGHT = 64,
  SAMPLE_PAD = 16,
  SAMPLE_GRAY_LIMIT = 150;
// Grayscale counterpart of digitCrop: same bounds, no binarization, dark
// digit on light ground for black-cell clues too.
export function grayCrop(entry, g, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05)),
    row = Math.floor(entry.cell / cols),
    col = entry.cell % cols,
    minX = Math.max(0, Math.round((col + 0.08) * cellWidth)),
    maxX = Math.min(imageWidth, Math.round((col + 0.92) * cellWidth)),
    minY = Math.max(0, Math.round((row + 0.08) * cellHeight)),
    maxY = Math.min(imageHeight, Math.round((row + 0.92) * cellHeight)),
    x = Math.max(minX, entry.x - pad),
    y = Math.max(minY, entry.y - pad),
    width = Math.max(1, Math.min(maxX, entry.x + entry.w + pad) - x),
    height = Math.max(1, Math.min(maxY, entry.y + entry.h + pad) - y),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d"),
    pixels = context.createImageData(width, height);
  for (let yy = 0; yy < height; yy++)
    for (let xx = 0; xx < width; xx++) {
      const source = g[(y + yy) * imageWidth + x + xx],
        value = entry.invert ? 255 - source : source,
        at = 4 * (yy * width + xx);
      pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = value;
      pixels.data[at + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
function sampleOf(source) {
  const scale = SAMPLE_HEIGHT / source.height,
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale)) + 2 * SAMPLE_PAD;
  canvas.height = SAMPLE_HEIGHT + 2 * SAMPLE_PAD;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, SAMPLE_PAD, SAMPLE_PAD, canvas.width - 2 * SAMPLE_PAD, SAMPLE_HEIGHT);
  return canvas.toDataURL("image/png");
}
// Read narrow glyphs as characters and wide numeric clues as a single line.
// Both retain independent binary/grayscale evidence without dropping possible
// second or third digits. The atlas remains the third vote.
export function digitSamples(entries, crops, g, w, h, cw, ch, cols) {
  const digits = [...crops.keys()];
  const withGray = digits.length <= SAMPLE_GRAY_LIMIT,
    singles = [];
  for (const i of digits) {
    const psm = crops.get(i).width > crops.get(i).height * 0.85 ? "7" : "10";
    singles.push({ index: i, kind: "binary", psm, png: sampleOf(crops.get(i)) });
    if (withGray)
      singles.push({
        index: i,
        kind: "gray",
        psm,
        png: sampleOf(grayCrop(entries[i], g, w, h, cw, ch, cols)),
      });
  }
  return singles;
}
// The atlas reading and the single-character readings vote per digit. A
// digit nobody could read keeps the atlas result, which downstream flags.
export function applyDigitVotes(entries, singles = []) {
  const byIndex = new Map();
  for (const single of singles) {
    if (!Number.isInteger(single?.index) || !entries[single.index]) continue;
    if (!byIndex.has(single.index)) byIndex.set(single.index, []);
    byIndex.get(single.index).push(single);
  }
  for (const [i, reads] of byIndex) {
    const entry = entries[i],
      original = { text: entry.text, confidence: entry.confidence },
      prior = voteDigit([original, ...reads.filter((read) => read.kind !== "retry")]),
      vote = voteDigit([original, ...reads]);
    if (!vote.text) continue;
    entry.text = vote.text;
    entry.confidence = !entry.recoveredMark && vote.unanimous &&
      (!reads.some((read) => read.kind === "retry") || (prior.unanimous && prior.text === vote.text))
      ? Math.max(90, vote.confidence) : 0;
  }
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
// OCR proposals must remain editable without relaxing the import/solver contract.
export function puzzleFromReadings({ entries, black, meta, mask, width, height, contrastAdjusted = false }, type, rows, cols) {
  const valueEntries = entries.filter((e) => ["value", "blackvalue"].includes(e.kind)),
    values = Array(rows * cols).fill(null),
    blackValueCells = new Set(),
    uncertain = new Set(),
    cageUncertain = new Set();
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
    notes = [],
    blackReadings = [];
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
    if (black[i] && ["hidato", "kakuro"].includes(chosen) &&
        Number.isInteger(v) && v > 0) {
      // This family cannot represent a numbered black clue. Keep the evidence
      // for an explicit Str8ts correction and never silently confirm the loss.
      blackReadings.push({ cell: i, value: v });
      uncertain.add(i);
    }
    if (v !== null && (v > max || v < (chosen === "slitherlink" ? 0 : 1))) {
      uncertain.add(i);
      v = null;
    }
    if (black[i] && chosen === "str8ts") { uncertain.add(i); return v ?? "#"; }
    if (black[i] && ["hidato", "kakuro"].includes(chosen)) return "#";
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
          if (e && +e.text >= 1 && +e.text <= 45) clue[d] = +e.text;
          else if (e) notes.push("A Kakuro target could not be read. Check the highlighted black cells.");
        }
        if (clue.across || clue.down) puzzle.clues.push(clue);
        uncertain.add(i);
      }
  }
  if (isCage(chosen)) {
    const areas = componentsForCages(mask, width, height, rows, cols, chosen);
    puzzle.cages = areas.flatMap((cells) => {
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
      cells.forEach((i) => cageUncertain.add(i));
      const operator = op.replace(/[xX×]/, "*").replace("÷", "/");
      if ((["-", "/"].includes(operator) && cells.length !== 2) ||
          (operator === "=" && cells.length !== 1)) {
        // Do not invent a different operator or partition to make bad OCR
        // valid. Leave these cells uncovered so Solve requires a cage edit.
        notes.push(`A cage covering ${cells.length} cells has an incompatible “${text}” reading. Check its boundary, target and operator.`);
        return [];
      }
      return [{
        cells,
        target: matches.length === 1 && Number.isSafeInteger(target) && target > 0 ? target : null,
        op: operator,
      }];
    });
  }
  conflicts(puzzle).forEach((i) => uncertain.add(i));
  const needsReview =
    contrastAdjusted ||
    (type === "auto" && suggested.review) ||
    isCage(chosen) ||
    ["futoshiki", "kakuro", "hidato", "numbrix", "slitherlink", "str8ts"].includes(
      chosen,
    );
  if (contrastAdjusted)
    notes.unshift("Low-contrast photo adjusted for recognition. Check the printed clues and any black cells against the original photograph.");
  if (type === "auto") notes.unshift(suggested.reason);
  if (isCage(chosen))
    notes.unshift(
      "Cage recognition is experimental. Check the entire partition: missing boundaries can merge cages.",
    );
  if (blackReadings.length)
    notes.unshift("Digits were read on black cells. They remain highlighted; choosing Str8ts restores compatible numbered clues. Check these readings against the photograph.");
  if (chosen === "str8ts") notes.unshift("Str8ts black cells may be blank or numbered; check every black cell before solving.");
  // A scan that marks printed cells but reads none of them is an engine or
  // version problem rather than a review task; say so, with the evidence a
  // remote diagnosis needs.
  const readDigits = valueEntries.filter((e) => values[e.cell] !== null).length;
  if (valueEntries.length >= 3 && readDigits === 0)
    notes.unshift(
      `Recognition found ${valueEntries.length} printed marks but could not read any digit (${entries.filter((e) => e.text).length} of ${entries.length} regions returned text; app build __BUILD_ID__). Install the app update if one is offered, then scan again; otherwise retake the photo straight on, in even light.`,
    );
  return {
    puzzle,
    blackReadings,
    markedCells: [...new Set(valueEntries.map((entry) => entry.cell))],
    uncertain: [...new Set([...uncertain, ...cageUncertain])],
    cellUncertain: [...uncertain],
    cageUncertain: [...cageUncertain],
    needsReview,
    notes: [...new Set(notes)].slice(0, 8),
  };
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
    const { image, meta, mask, g, black, entries, contrastAdjusted } = await this.geometry(
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
    // One bounded atlas call for every region, plus cheap single-character
    // re-reads of the digits so that three readings can vote. The sparse-text
    // mode and character boxes preserve the original clue slots.
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
    const crops = new Map();
    entries.forEach((e, i) => {
      const isDigit = ["value", "blackvalue"].includes(e.kind),
        source = isDigit
          ? digitCrop(e, g, w, h, cw, ch, cols)
          : e.invert
            ? rectified
            : bw,
        sx = isDigit ? 0 : e.x,
        sy = isDigit ? 0 : e.y,
        sw = isDigit ? source.width : e.w,
        sh = isDigit ? source.height : e.h,
        scale = Math.min((tile * 74) / 112 / sw, (tile * 72) / 112 / sh),
        dw = sw * scale,
        dh = sh * scale,
        x = (i % columns) * tile + (tile - dw) / 2,
        y = Math.floor(i / columns) * tile + (tile - dh) / 2;
      ctx.save();
      if (!isDigit && e.invert) ctx.filter = "invert(1)";
      ctx.drawImage(source, sx, sy, sw, sh, x, y, dw, dh);
      ctx.restore();
      if (isDigit) crops.set(i, source);
    });
    const singles = digitSamples(entries, crops, g, w, h, cw, ch, cols);
    check();
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
      { png, singles },
      onProgress,
      "classic",
    );
    check();
    const readings = mapAtlas(data, entries.length, columns, tile);
    entries.forEach((e, i) => {
      e.text = readings[i].text;
      e.confidence = readings[i].confidence;
    });
    applyDigitVotes(entries, data.singles);
    return {
      ...puzzleFromReadings({ entries, black, meta, mask, width: w, height: h, contrastAdjusted }, type, rows, cols),
      rectified,
      entries,
      retryCount: data.retryCount || 0,
    };
  }
}
