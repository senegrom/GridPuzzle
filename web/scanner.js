import { validateRetryCells, evidenceKey } from "./clue-recovery.js";
import { numericCropBounds } from './cell-boundaries.js';
import { createOCRRuntime } from "./ocr-runtime.js";
import { makePuzzle, classify, conflicts, isCage } from "./model.js";
import { mapAtlas, atlasLayout, voteDigit } from "./ocr-map.js";
import { separatedCrops, applySeparatedReading } from "./ocr-segments.js";
import { aspectEligible, aspectSamples, applyAspectReading } from "./ocr-aspect.js";
import { fraction, turnCorners, otsuCut } from "./geometry.js";
const aborted = () => new DOMException("Scan cancelled", "AbortError");
function imageOf(canvas) {
  return canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
}
function canvasOf(image) {
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
function otsuThreshold(g, width, x, y, w, h) {
  const histogram = new Uint32Array(256);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) histogram[g[yy * width + xx]]++;
  return otsuCut(histogram);
}
export function digitCrop(entry, g, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05)),
    { minX, maxX, minY, maxY } = numericCropBounds(entry, imageWidth, imageHeight, cellWidth, cellHeight, cols),
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
// A cage clue as measured on the corpus: the clue box scaled to 40 px high
// with a 16 px white margin, then binarized at its own Otsu threshold, which
// read 69-93% of clean and 60-85% of printed rendered clues in the atlas.
export function cageLabelCrop(entry, rectified) {
  const height = 40, scale = height / Math.max(1, entry.h), out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(entry.w * scale)) + 32;
  out.height = height + 32;
  const context = out.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, out.width, out.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(rectified, entry.x, entry.y, entry.w, entry.h, 16, 16, out.width - 32, height);
  const pixels = context.getImageData(0, 0, out.width, out.height), d = pixels.data, histogram = new Uint32Array(256);
  const lum = (i) => Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  // The threshold comes from the clue box alone. Counting the white margin
  // made it the light class, so a clue on grey paper (a dim photograph)
  // turned to solid ink, paper and all. The margin stays white, since the
  // cut is always below 255.
  for (let y = 16; y < 16 + height; y++)
    for (let x = 16; x < out.width - 16; x++) histogram[lum(4 * (y * out.width + x))]++;
  const cut = otsuCut(histogram);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(i) <= cut ? 0 : 255;
  context.putImageData(pixels, 0, 0);
  return out;
}
const SAMPLE_HEIGHT = 64,
  SAMPLE_PAD = 16,
  SAMPLE_GRAY_LIMIT = 150;
// Grayscale counterpart of digitCrop: same bounds, no binarization, dark
// digit on light ground for black-cell clues too.
function grayCrop(entry, g, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05)),
    { minX, maxX, minY, maxY } = numericCropBounds(entry, imageWidth, imageHeight, cellWidth, cellHeight, cols),
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
function sampleCanvas(source) {
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
  return canvas;
}
function sampleOf(source) { return sampleCanvas(source).toDataURL("image/png"); }
// Read narrow glyphs as characters and wide numeric clues as a single line.
// Both retain independent binary/grayscale evidence without dropping possible
// second or third digits. The atlas remains the third vote.
export function digitSamples(entries, crops, g, w, h, cw, ch, cols) {
  const digits = [...crops.keys()];
  const withGray = digits.length <= SAMPLE_GRAY_LIMIT,
    singles = [];
  let aspectBudget = 48; // At most 24 optional pairs, independent of the OCR-call ceiling.
  let segmentBudget = 72; // Bound optional raster packing independently of OCR calls.
  for (const i of digits) {
    // Two narrow neighbouring glyphs (for example "11") can still have a
    // portrait-shaped crop. Segmentation evidence beats the aspect heuristic.
    const psm = entries[i].glyphCount > 1 ||
      crops.get(i).width > crops.get(i).height * 0.85 ? "7" : "10";
    singles.push({ index: i, kind: "binary", psm, png: sampleOf(crops.get(i)) });
    if (withGray) {
      const separated = entries[i].segments?.length <= segmentBudget
        ? separatedCrops(entries[i], g, w, h, cw, ch) : [];
      segmentBudget -= separated.length;
      const graySample = sampleCanvas(grayCrop(entries[i], g, w, h, cw, ch, cols)),
        aspect = aspectBudget >= 2 && aspectEligible(entries[i]) ? aspectSamples(graySample) : [];
      aspectBudget -= aspect.length;
      singles.push({
        index: i,
        kind: "gray",
        psm,
        png: graySample.toDataURL("image/png"),
        ...(aspect.length ? { aspect } : {}),
        ...(separated.length ? { segments: separated.map(sampleOf) } : {}),
      });
    }
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
      ordinary = [original, ...reads.filter((read) => read.kind !== "aspect")],
      whole = reads.filter((read) => !["segments", "aspect"].includes(read.kind)),
      prior = voteDigit([original, ...whole.filter((read) => read.kind !== "retry")]),
      vote = voteDigit([original, ...whole]);
    if (vote.text) {
      entry.text = vote.text;
      entry.confidence = !entry.recoveredMark && !entry.refinedCell && vote.unanimous &&
        (!reads.some((read) => read.kind === "retry") || (prior.unanimous && prior.text === vote.text))
        ? Math.max(90, vote.confidence) : 0;
    }
    applySeparatedReading(entry, ordinary);
    if (entry.glyphCount > 1 && /^\d+$/.test(entry.text) && entry.text.length < entry.glyphCount)
      entry.confidence = 0;
    applyAspectReading(entry, [original, ...reads]);
  }
  // Even a unanimous whole-crop truncation is not evidence that a detected
  // second glyph was blank. Keep the discrepancy visible if retries ran out.
  for (const entry of entries)
    if (entry.glyphCount > 1 && /^\d+$/.test(entry.text) && entry.text.length < entry.glyphCount)
      entry.confidence = 0;
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
export function puzzleFromReadings({ entries, black, meta, mask, width, height, contrastAdjusted = false, unreadCells = [], cageAreas = null }, type, rows, cols) {
  const valueEntries = entries.filter((e) => ["value", "blackvalue"].includes(e.kind)),
    values = Array(rows * cols).fill(null),
    blackValueCells = new Set(),
    uncertain = new Set(unreadCells),
    cageUncertain = new Set();
  for (const e of valueEntries) {
    if (/^\d{1,3}$/.test(e.text)) values[e.cell] = +e.text;
    if (e.kind === "blackvalue" && values[e.cell] !== null) blackValueCells.add(e.cell);
    if (values[e.cell] === null || e.confidence < 85 || e.recoveredMark || e.refinedCell) uncertain.add(e.cell);
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
  if (chosen === "futoshiki") {
    // Every sign region is a proposal for review, never a confirmed clue: its
    // two cells go to structural review (the cage channel), not digit review,
    // since neither digit is in doubt. A clear chevron shape reads the sign
    // (readChevron: measured right on every rendered sign); otherwise the
    // OCR reading, if it is a sign; otherwise the region stays unread, since
    // dropping it would silently remove a printed constraint.
    const regions = entries.filter((e) => ["hsign", "vsign"].includes(e.kind)),
      read = (e) => e.chevron ?? (/^[<>^vV]$/.test(e.text) ? e.text : null);
    puzzle.inequalities = regions.flatMap((e) => {
      cageUncertain.add(e.cell); cageUncertain.add(e.other);
      const text = read(e);
      if (!text) return [];
      const smallerFirst = ["<", "^"].includes(text);
      return [{ less: smallerFirst ? e.cell : e.other, greater: smallerFirst ? e.other : e.cell }];
    });
    const unread = regions.filter((e) => !read(e)).length, proposed = regions.length - unread,
      plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    if (regions.length)
      notes.push(`${plural(proposed, "inequality sign")} read for checking${unread ? `, ${unread} more could not be read` : ""}. Their cells are highlighted: confirm each sign, and add any missing one with Inequality under Editing.`);
  }
  if (chosen === "kakuro") {
    for (let i = 0; i < puzzle.cells.length; i++)
      if (puzzle.cells[i] === "#") {
        const clue = { cell: i };
        for (const d of ["across", "down"]) {
          const e = triangles.find((e) => e.cell === i && e.kind === d),
            raw = entries.find((entry) => entry.cell === i && entry.kind === d),
            note = "A Kakuro target could not be read. Check the highlighted black cells.";
          if (e && +e.text >= 1 && +e.text <= 45) clue[d] = +e.text;
          // A triangle that read as something other than 1..45 (a stray operator,
          // a third digit) is an unread target too, not a blank corner.
          else if ((e || raw?.text) && !notes.includes(note)) notes.push(note);
        }
        if (clue.across || clue.down) puzzle.clues.push(clue);
        uncertain.add(i);
      }
  }
  if (isCage(chosen)) {
    // An explicit cage type arrives partitioned (scan-analysis.js cagePartition).
    const areas = cageAreas ?? componentsForCages(mask, width, height, rows, cols, chosen);
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
    markedCells: [...new Set([...unreadCells, ...valueEntries.map((entry) => entry.cell)])],
    uncertain: [...new Set([...uncertain, ...cageUncertain])],
    cellUncertain: [...uncertain],
    cageUncertain: [...cageUncertain],
    needsReview,
    notes: [...new Set(notes)].slice(0, 8),
  };
}
// Cells whose digit carries no review flag: what a reading has to offer.
export function confidentDigits(found) {
  const uncertain = new Set(found.uncertain ?? []);
  return found.puzzle.cells.filter((value, cell) => Number.isInteger(value) && !uncertain.has(cell)).length;
}
// Median height/width of single, clue-sized value glyphs (at least half the
// 75th-percentile height): about 1.4 upright, under 0.75 a quarter turn away.
// Infinity without six such glyphs, which is no evidence either way.
export function glyphAspect(values) {
  const heights = values.map((e) => e.h).sort((a, b) => a - b);
  if (heights.length < 6) return Infinity;
  const reference = heights[Math.floor(0.75 * (heights.length - 1))],
    ratios = values.filter((e) => !(e.glyphCount > 1) && e.h >= 0.5 * reference && e.w >= 0.3 * reference)
      .map((e) => e.h / e.w).sort((a, b) => a - b);
  return ratios.length < 6 ? Infinity : ratios[ratios.length >> 1];
}
export class Scanner {
  constructor() {
    this.epoch = 0;
    this.jobs = new Set();
    // One warm OCR engine and one geometry worker per scanner. Starting a
    // Tesseract worker and loading its language costs more than a whole read
    // on a phone, so successive reads must not pay it again.
    this.ocr = createOCRRuntime();
    this.geometryWorker = null;
    this.geometryBusy = false;
  }
  prepare() { this.ocr.prepare(); }
  cancel({ keepEngine = false } = {}) {
    this.epoch++;
    if (keepEngine) this.ocr.cancel();
    else this.ocr.dispose();
    for (const job of this.jobs) job.cancel();
    this.jobs.clear();
    if (!keepEngine && this.geometryWorker) {
      this.geometryWorker.terminate(); this.geometryWorker = null; this.geometryBusy = false;
    }
  }
  _request(path, payload, onProgress = () => {}, type = "module") {
    return new Promise((resolve, reject) => {
      const geometry = path === "geometry-worker.js";
      const worker = geometry && this.geometryWorker && !this.geometryBusy
        ? this.geometryWorker : new Worker(new URL(path, import.meta.url), { type });
      if (geometry && !this.geometryWorker) this.geometryWorker = worker;
      if (this.geometryWorker === worker) this.geometryBusy = true;
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
        } else if (geometry && !error && !cancel && this.geometryWorker === worker) {
          // A finished geometry request leaves an idle, reusable worker.
          this.geometryBusy = false;
        } else {
          worker.terminate();
          if (this.geometryWorker === worker) { this.geometryWorker = null; this.geometryBusy = false; }
        }
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
        end("error" in data ? Error(data.error || "Image processing failed") : null, data.result);
      };
      worker.onerror = (e) =>
        end(Error(e.message || "Image processing failed"), null, true);
      try {
        // Pixel buffers are fresh per request: transfer them instead of copying.
        worker.postMessage(payload, payload.image?.data?.buffer ? [payload.image.data.buffer] : []);
      } catch (error) {
        end(error, null, true);
      }
    });
  }
  geometry(op, options) {
    return this._request("geometry-worker.js", { op, ...options });
  }
  // `thorough` runs the last-resort readings (inverted screens, continuous
  // runs, dot lattices). They cost a still photograph a fraction of a second
  // and would stall a live preview, which sees an unframed grid every frame.
  detect(canvas, { thorough = true, rows = null, cols = null } = {}) {
    return this.geometry("detect", { image: imageOf(canvas), thorough, rows, cols });
  }
  readCells(canvas, corners, found, cells, onProgress = () => {}, options = {}) {
    const { type, rows, cols } = found.puzzle;
    const skipEvidence = Object.fromEntries((found.entries ?? []).filter(e => ["value", "blackvalue"].includes(e.kind)).map(e => [e.cell, e.evidence]));
    return this.read(canvas, corners, type, rows, cols, onProgress, { ...options, cells, skipEvidence });
  }
  async read(canvas, corners, type, rows, cols, onProgress = () => {}, options = {}) {
    const targetCells = (options.cells ?? null) === null ? null : validateRetryCells(options.cells, rows, cols);
    if (targetCells && ['auto', 'kakuro', 'kenken', 'killersudoku'].includes(type))
      throw Error('Structural clues need a full scan and review.');
    this.cancel({ keepEngine: true });
    const epoch = this.epoch,
      check = () => {
        if (epoch !== this.epoch) throw aborted();
      };
    const found = await this.readOnce(canvas, corners, type, rows, cols, onProgress, options, targetCells, check);
    check();
    // Orientation is a property of a still photograph: a live preview keeps
    // the tracked corners, a targeted re-read keeps its grid's orientation, and
    // only a square grid reads the same size after a quarter turn.
    if (targetCells || options.orient === false || rows !== cols) return found;
    return this.orient(found, canvas, corners, type, rows, cols, onProgress, options, check);
  }
  // A photograph can reach the reader a quarter turn off: a phone labels a
  // page shot flat on a table with whatever way it happened to be held.
  // Printed clue glyphs are taller than wide, so the turn shows as glyphs
  // wider than tall, and as a poor reading. Both quarter turns are then read
  // and one is kept only when it reads clearly more confident digits. A half
  // turn keeps upright-shaped glyphs, and a poor reading alone is too common
  // (handwriting, blur) to pay for another read: Rotate covers that case.
  async orient(found, canvas, corners, type, rows, cols, onProgress, options, check) {
    const confident = confidentDigits(found),
      values = found.entries.filter((e) => e.kind === "value");
    if (!(glyphAspect(values) < 1) || confident >= values.length / 2) return found;
    let best = { found, confident, turns: 0 };
    for (const turns of [1, 3]) {
      check();
      onProgress("Checking which way up the photograph is…", null);
      check();
      let turned;
      try {
        turned = await this.readOnce(canvas, turnCorners(corners, turns), type, rows, cols, () => {},
          { onDiagnostic: options.onDiagnostic }, null, check);
      } catch (error) {
        // An optional orientation may have no readable clues or a failed
        // worker. Keep the best completed reading and try the other turn.
        // Cancellation/supersession, even when reported as an ordinary
        // error by a retired worker, must never return an obsolete reading.
        check();
        if (error?.name === "AbortError") throw error;
        continue;
      }
      check();
      const n = confidentDigits(turned);
      if (n > best.confident) best = { found: turned, confident: n, turns };
    }
    if (!best.turns || best.confident < Math.max(8, 2 * confident + 3)) return found;
    return {
      ...best.found,
      turns: best.turns,
      notes: [`The photograph was read turned a quarter turn ${best.turns === 1 ? "anticlockwise" : "clockwise"}: its digits read clearly better that way, so the crop corners were turned with it. Check the clues against the photograph.`, ...best.found.notes],
    };
  }
  async readOnce(canvas, corners, type, rows, cols, onProgress, { onPreview = () => {}, skipEvidence = {}, onDiagnostic = () => {} }, targetCells, check) {
    const started = performance.now();
    onDiagnostic({ stage: "preparing", reason: targetCells ? "targeted" : "full-read", targets: targetCells ?? [] });
    onProgress("Straightening the photograph…", null);
    const { image, meta, mask, g, black, entries: regions, contrastAdjusted, unreadCells, cageAreas } = await this.geometry(
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
    const entries = targetCells ? regions.filter(e => targetCells.includes(e.cell) && ['value', 'blackvalue'].includes(e.kind)) : regions;
    const prepared = performance.now();
    const w = image.width,
      h = image.height,
      cw = w / cols,
      ch = h / rows,
      rectified = canvasOf(image);
    const emptyRetry = () => ({
      ...puzzleFromReadings({ entries: [], black, meta, mask, width: w, height: h, contrastAdjusted, cageAreas,
        unreadCells: targetCells }, type, rows, cols),
      entries: [], targetCells, blackLayout: black.flatMap((v,i) => v ? [i] : []), rectified,
      ocrStats: { calls: 0, samples: 0 }, timings: { prepare: prepared - started, total: performance.now() - started },
    });
    if (targetCells && !entries.length) return emptyRetry();
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
        // White-on-black triangle and label crops are inverted per pixel by
        // grayCrop: canvas filters are unsupported in shipping Safari, where
        // ctx.filter = "invert(1)" is a silent no-op.
        cropped = isDigit || e.invert || e.cageLabel,
        source = isDigit
          ? digitCrop(e, g, w, h, cw, ch, cols)
          : e.cageLabel
            ? cageLabelCrop(e, rectified)
            : e.invert
              ? grayCrop(e, g, w, h, cw, ch, cols)
              : bw,
        sx = cropped ? 0 : e.x,
        sy = cropped ? 0 : e.y,
        sw = cropped ? source.width : e.w,
        sh = cropped ? source.height : e.h,
        scale = Math.min((tile * 74) / 112 / sw, (tile * 72) / 112 / sh),
        dw = sw * scale,
        dh = sh * scale,
        x = (i % columns) * tile + (tile - dw) / 2,
        y = Math.floor(i / columns) * tile + (tile - dh) / 2;
      ctx.drawImage(source, sx, sy, sw, sh, x, y, dw, dh);
      if (isDigit) crops.set(i, source);
    });
    const singles = digitSamples(entries, crops, g, w, h, cw, ch, cols);
    const evidence = new Map();
    for (const single of singles) {
      if (!evidence.has(single.index)) evidence.set(single.index, []);
      evidence.get(single.index).push(single.png);
    }
    for (const [index, samples] of evidence) entries[index].evidence = evidenceKey(samples);
    if (targetCells && entries.every(e => e.evidence && e.evidence === skipEvidence[e.cell])) {
      onDiagnostic({ stage: 'checking', reason: 'identical-crops', targets: targetCells });
      return { ...emptyRetry(), identicalCrops: true };
    }
    onDiagnostic({ stage: 'reading', reason: targetCells ? 'targeted' : 'full-read', regions: entries.length, targets: targetCells ?? [] });
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
    const packed = performance.now();
    // The atlas pass finishes long before the independent per-digit checks.
    // Offer it as a provisional, fully review-flagged reading so a live view
    // can show yellow clues early; only the checked transcription is returned.
    const data = await this.ocr.recognize({ png, singles }, onProgress, (atlasData) => {
      check();
      const readings = mapAtlas(atlasData, entries.length, columns, tile);
      const provisional = entries.map((entry, i) => ({ ...entry, text: readings[i].text, confidence: 0 }));
      onPreview({
        ...puzzleFromReadings({ entries: provisional, black, meta, mask, width: w, height: h, contrastAdjusted, unreadCells, cageAreas }, type, rows, cols),
        rectified, entries: provisional, refining: true, needsReview: true,
      });
    });
    check();
    const readings = mapAtlas(data, entries.length, columns, tile);
    entries.forEach((e, i) => {
      e.text = readings[i].text;
      e.confidence = readings[i].confidence;
    });
    applyDigitVotes(entries, data.singles);
    onDiagnostic({ stage: "checking", reason: "ocr-complete", regions: entries.length, calls: data.ocrStats?.calls ?? 0 });
    return {
      ...puzzleFromReadings({ entries, black, meta, mask, width: w, height: h, contrastAdjusted, unreadCells, cageAreas }, type, rows, cols),
      rectified,
      entries,
      ...(targetCells ? { targetCells, blackLayout: black.flatMap((v,i) => v ? [i] : []) } : {}),
      retryCount: data.retryCount || 0,
      ocrStats: data.ocrStats,
      timings: { prepare: prepared - started, pack: packed - prepared, ocr: performance.now() - packed, total: performance.now() - started },
    };
  }
}
