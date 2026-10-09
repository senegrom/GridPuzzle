// Page side of probe_offline.cjs (classic script; defines window.probeScene).
(function () {
  const W = 720, H = 900, GX = 60, GY = 180, GS = 600, CELLPX = GS / 9;
  const cells = Array(81).fill(null);
  for (let k = 0; k < 27; k++) {
    const i = (k * 37 + 13) % 81, r = Math.floor(i / 9), c = i % 9;
    cells[i] = (r * 3 + Math.floor(r / 3) + c) % 9 + 1;
  }
  let P = null;
  async function setup() {
    if (P) return P;
    P = {};
    P.Scanner = (await import("./scanner.js")).Scanner;
    P.createTrackingCore = (await import("./live-tracking-core.js")).createTrackingCore;
    P.recovery = await import("./clue-recovery.js");
    let src = await (await fetch("./live-content.js")).text();
    const patch = (from, to) => { if (src.split(from).length !== 2) throw Error("patch: " + from.slice(0, 60)); src = src.replace(from, to); };
    patch('from "./geometry.js"', `from "${new URL("./geometry.js", location.href)}"`);
    patch("function sameRegions(rawA, rawB, stretch, checks, diagnostic) {", "function sameRegions(rawA, rawB, stretch, checks, diagnostic) { let __failed = false;");
    patch(`    for (const [fraction, average, detail] of checks)
      if (!regionMatches(a, b, fraction, average, detail, rangesA, rangesB, histogram)) {
        // Numeric region position and a bounded reason only; never raw pixels.
        if (diagnostic) { diagnostic.reason = stretch ? 'cell-content' : 'structural-content'; diagnostic.region = offset / CELL; }
        return false;
      }
  }
  return true;`, `    for (const [fraction, average, detail] of checks) {
      globalThis.__probeCheck = { stretch, region: offset / CELL, fraction, average, detail, best: Infinity };
      const __ok = regionMatches(a, b, fraction, average, detail, rangesA, rangesB, histogram);
      globalThis.__probeRecord?.({ ...globalThis.__probeCheck, ok: __ok });
      globalThis.__probeCheck = null;
      if (!__ok) {
        if (diagnostic && !__failed) { diagnostic.reason = stretch ? 'cell-content' : 'structural-content'; diagnostic.region = offset / CELL; }
        if (!globalThis.__probeAll) return false;
        __failed = true; break;
      }
    }
  }
  return !__failed;`);
    patch(`  return sameRegions(a.pixels, b.pixels, true, [[.03, 2.5, false], [.01, .06, true]], diagnostic) &&
    sameRegions(a.structure, b.structure, false, [[.01, .8, false], [.01, .06, true]], diagnostic);`,
    `  const __p = sameRegions(a.pixels, b.pixels, true, [[.03, 2.5, false], [.01, .06, true]], diagnostic);
  if (!__p && !globalThis.__probeAll) return false;
  return sameRegions(a.structure, b.structure, false, [[.01, .8, false], [.01, .06, true]], diagnostic) && __p;`);
    patch("  return changed <= count * fraction || difference <= count * average;",
      "  if (globalThis.__probeCheck) globalThis.__probeCheck.best = Math.min(globalThis.__probeCheck.best, changed / (count * fraction), difference / (count * average));\n  return changed <= count * fraction || difference <= count * average;");
    P.content = await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    P.detector = new P.Scanner(); P.reader = new P.Scanner();
    const recognize = P.reader.ocr.recognize.bind(P.reader.ocr);
    P.reader.ocr.recognize = async (...args) => { const data = await recognize(...args); P.lastOcr = data; return data; };
    // structure region index -> description
    P.structure = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      for (const dy of [0, .16]) for (const dx of [.01, .37]) P.structure.push(`${r * 9 + c}:label(${dx},${dy})`);
      if (c < 8) P.structure.push(`${r * 9 + c}:right`);
      if (r < 8) P.structure.push(`${r * 9 + c}:bottom`);
    }
    return P;
  }
  // The suite's paint(), with the digits shifted by (dx, dy) and a choice of
  // degradation for cell 52 (the suite's: a 50x50 window at +8 resampled to
  // 20x20 and back).
  function paint(ctx, { font = "Courier New", size = 27, weight = "", yoff = 0, dx = 0, dy = 0, sharp = false, changed = false, degrade = { kind: "resample" }, tick = 1, baseline = "font-box" }) {
    ctx.save();
    ctx.fillStyle = "#edf1f5"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tick % 2 ? "#ff0000" : "#0000ff"; ctx.fillRect(0, 0, 20, 20);
    for (let k = 0; k <= 9; k++) {
      ctx.strokeStyle = k % 3 ? "#a5aab3" : "#343c43"; ctx.lineWidth = k % 3 ? 1 : 3;
      ctx.beginPath(); ctx.moveTo(GX + k * GS / 9, GY); ctx.lineTo(GX + k * GS / 9, GY + GS);
      ctx.moveTo(GX, GY + k * GS / 9); ctx.lineTo(GX + GS, GY + k * GS / 9); ctx.stroke();
    }
    ctx.fillStyle = "#24282c"; ctx.font = `${weight ? weight + " " : ""}${size}px ${font}`; ctx.textAlign = "center";
    let offset = 0;
    if (baseline === "font-box") {
      ctx.textBaseline = "alphabetic";
      const box = ctx.measureText("0"); offset = (box.fontBoundingBoxAscent - box.fontBoundingBoxDescent) / 2;
    } else if (baseline === "ink") {
      ctx.textBaseline = "alphabetic";
      const box = ctx.measureText("0"); offset = (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
    } else ctx.textBaseline = baseline;
    cells.forEach((v, i) => {
      if (v !== null) ctx.fillText(String(changed && i === 13 ? 9 : v), GX + (i % 9 + .5) * CELLPX + dx, GY + (Math.floor(i / 9) + .5) * CELLPX + offset + yoff + dy);
    });
    if (!sharp) degradeCell(ctx, 52, degrade);
    ctx.fillStyle = changed ? "#00ff00" : "#ff00ff"; ctx.fillRect(25, 0, 20, 20);
    ctx.restore();
  }
  function degradeCell(ctx, cell, d) {
    const left = GX + (cell % 9) * CELLPX, top = GY + Math.floor(cell / 9) * CELLPX;
    if (d.kind === "none") return;
    if (d.kind === "resample") {
      const inset = d.inset ?? 8, size = d.size ?? 50, small = d.small ?? 20;
      const x = Math.round(left) + inset, y = Math.round(top) + inset;
      const tiny = document.createElement("canvas"); tiny.width = tiny.height = small;
      tiny.getContext("2d").drawImage(ctx.canvas, x, y, size, size, 0, 0, small, small);
      ctx.drawImage(tiny, 0, 0, small, small, x, y, size, size);
      return;
    }
    // JS box/gauss blurs: engine-independent arithmetic on the window.
    const x0 = Math.round(left + (d.x0 ?? 8)), y0 = Math.round(top + (d.y0 ?? 8));
    const w = Math.round(d.w ?? 50), h = Math.round(d.h ?? 50);
    const image = ctx.getImageData(x0, y0, w, h), data = image.data;
    if (d.kind === "gauss") {
      const sigma = d.sigma, radius = Math.ceil(3 * sigma), kernel = [];
      let sum = 0;
      for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); kernel.push(v); sum += v; }
      for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
      // Source outside the window: read a padded copy from the canvas.
      const px = x0 - radius, py = y0 - radius, pw = w + 2 * radius, ph = h + 2 * radius;
      const padded = ctx.getImageData(px, py, pw, ph).data, tmp = new Float32Array(pw * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += kernel[k + radius] * padded[((y + radius + k) * pw + x) * 4 + ch];
        tmp[(y * pw + x) * 3 + ch] = acc;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += kernel[k + radius] * tmp[(y * pw + x + radius + k) * 3 + ch];
        data[(y * w + x) * 4 + ch] = Math.round(acc);
      }
    } else if (d.kind === "contrast") {
      // Mix towards the paper colour: ink keeps (1 - amount) of its contrast.
      const paper = [0xed, 0xf1, 0xf5];
      for (let i = 0; i < data.length; i += 4) for (let ch = 0; ch < 3; ch++) data[i + ch] = Math.round(data[i + ch] + (paper[ch] - data[i + ch]) * d.amount);
    } else throw Error("unknown degradation " + d.kind);
    ctx.putImageData(image, x0, y0);
  }
  async function viaStream(canvas) {
    const stream = canvas.captureStream(0), video = document.createElement("video"), track = stream.getVideoTracks()[0];
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    video.style.cssText = "position:fixed;left:0;top:0;width:200px;height:250px"; document.body.append(video);
    const limit = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error(what + " timed out")), ms))]);
    let ticks = 0;
    const pump = setInterval(() => { const c = canvas.getContext("2d"); c.fillStyle = ++ticks % 2 ? "#ff0000" : "#0000ff"; c.fillRect(0, 0, 20, 20); track.requestFrame(); }, 40);
    try {
      track.requestFrame();
      await limit(video.play(), 15000, "play");
      for (let i = 0; i < 3; i++) await limit(new Promise((resolve) => video.requestVideoFrameCallback(resolve)), 5000, "frame");
      const out = document.createElement("canvas"); out.width = video.videoWidth; out.height = video.videoHeight;
      out.getContext("2d").drawImage(video, 0, 0, out.width, out.height);
      return out;
    } finally {
      clearInterval(pump); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; video.remove();
    }
  }
  async function frame(config, sharp, changed = false) {
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    paint(canvas.getContext("2d", { willReadFrequently: true }), { ...config, sharp, changed });
    return config.stream ? viaStream(canvas) : canvas;
  }
  async function detect(image) {
    const small = document.createElement("canvas"), scale = Math.min(1, 640 / Math.max(image.width, image.height));
    small.width = Math.round(image.width * scale); small.height = Math.round(image.height * scale);
    small.getContext("2d").drawImage(image, 0, 0, small.width, small.height);
    const found = await P.detector.detect(small, { thorough: false, rows: 9, cols: 9 });
    const corners = found.corners?.map((p) => ({ x: p.x * (image.width - 1) / (small.width - 1), y: p.y * (image.height - 1) / (small.height - 1) }));
    return { corners, quality: found.quality, confidence: found.confidence, q52: found.quality?.cells?.find((c) => c.cell === 52) ?? null };
  }
  const pixelsOf = (image) => image.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, image.width, image.height);
  function contentStats(Dp, Sp, cornersD, cornersS) {
    const records = [];
    globalThis.__probeAll = true; globalThis.__probeRecord = (r) => records.push(r);
    try {
      const a = P.content.gridContent(Dp, cornersD, 9, 9), b = P.content.gridContent(Sp, cornersS, 9, 9), diag = {};
      const same = P.content.sameGridContent(a, b, diag);
      return { same, diag, records };
    } finally { globalThis.__probeAll = false; globalThis.__probeRecord = null; }
  }
  function describe(rec) {
    const best = rec.best === Infinity ? 0 : rec.best;
    return { where: rec.stretch ? `cell${rec.region}` : P.structure[rec.region], test: rec.detail ? "detail" : "hi", best, ok: rec.ok };
  }
  window.probeScene = async function (config) {
    await setup();
    const D = await frame(config, false), S = await frame(config, true);
    const Dd = await detect(D), Sd = await detect(S);
    const Dp = pixelsOf(D), Sp = pixelsOf(S);
    // The tracking core: anchor D, anchor S with D kept (the detection match),
    // and verify S against D's anchor (the session's proof).
    const core = P.createTrackingCore();
    const a1 = core.run({ op: "anchor", image: Dp, corners: Dd.corners, rows: 9, cols: 9, anchors: [] }).anchor;
    const a2 = core.run({ op: "anchor", image: Sp, corners: Sd.corners, rows: 9, cols: 9, anchors: [a1.id] }).anchor;
    const v = core.run({ op: "verify", image: Sp, anchors: [a1.id] });
    const track = { anchorMatch: a2?.matches?.[a1.id] ?? null, verifyProof: !!v.proofs[a1.id], rejection: v.rejections?.[a1.id] ?? null };
    const st = contentStats(Dp, Sp, Dd.corners, v.proofs[a1.id]?.corners ?? Dd.corners);
    const near = (w) => /^cell52$/.test(w) || /^52:/.test(w) || /^(43|51):(bottom|right)/.test(w);
    const stats = { same: st.same, diag: st.diag,
      failing: st.records.filter((r) => !r.ok).map(describe),
      near52: st.records.map(describe).filter((r) => near(r.where)) };
    const result = { config, D: { corners: Dd.corners, q52: Dd.q52, reason: Dd.quality?.reason, confidence: Dd.confidence },
      S: { corners: Sd.corners, q52: Sd.q52, reason: Sd.quality?.reason }, track, stats };
    if (config.race) {
      // The changed puzzle (cell 13: 8 -> 9) against the sharp anchor.
      const C = await frame(config, true, true), Cd = await detect(C), Cp = pixelsOf(C);
      const a3 = core.run({ op: "anchor", image: Cp, corners: Cd.corners, rows: 9, cols: 9, anchors: [a2.id] }).anchor;
      const cs = contentStats(Sp, Cp, Sd.corners, Cd.corners);
      result.race = { anchorMatch: a3?.matches?.[a2.id] ?? null, failing: cs.records.filter((r) => !r.ok).map(describe),
        cell13: cs.records.map(describe).filter((r) => r.where === "cell13") };
    }
    if (config.ocr !== false) {
      const found = await P.reader.read(D, Dd.corners, "sudoku", 9, 9, () => {}, { orient: false });
      found.puzzle.boxRows = 3; found.puzzle.boxCols = 3; found.needsReview = true;
      const i52 = found.entries.findIndex((e) => e.cell === 52), e52 = found.entries[i52];
      const singles52 = (P.lastOcr?.singles ?? []).filter((s) => s.index === i52).map((s) => `${s.kind}:${s.text}/${Math.round(s.confidence ?? -1)}`);
      const unc = new Set(found.uncertain ?? []), marked = new Set(found.markedCells ?? []);
      result.ocr = { cell52: { text: e52?.text ?? null, confidence: e52?.confidence ?? null, value: found.puzzle.cells[52], uncertain: unc.has(52), marked: marked.has(52),
          recoveredMark: !!e52?.recoveredMark, refinedCell: !!e52?.refinedCell, glyphCount: e52?.glyphCount ?? 1, box: e52 ? [e52.x, e52.y, e52.w, e52.h] : null, singles: singles52 },
        wrong: found.puzzle.cells.flatMap((v, i) => i !== 52 && v !== cells[i] ? [i] : []),
        uncertainOthers: [...unc].filter((i) => i !== 52), calls: found.ocrStats?.calls ?? null,
        recoveryCells: P.recovery.recoveryCells(found) };
      result.clearer = P.recovery.clearerCells(found, Dd.quality, Sd.quality, new Map());
      if (config.targeted !== false && result.ocr.recoveryCells.includes(52)) {
        const retry = await P.reader.readCells(S, Sd.corners, found, [52], () => {});
        const t52 = (retry.entries ?? []).findIndex((e) => e.cell === 52);
        const tsingles = (P.lastOcr?.singles ?? []).filter((s) => s.index === t52).map((s) => `${s.kind}:${s.text}/${Math.round(s.confidence ?? -1)}`);
        let merged = null;
        try { merged = P.recovery.mergeRecoveredClues(found, retry, [52]); } catch (error) { merged = { error: error.message }; }
        result.targeted = { value52: merged?.puzzle?.cells?.[52] ?? null, proposals: merged?.recovery?.proposals ?? null, calls: retry.ocrStats?.calls ?? null,
          entry: (retry.entries ?? []).map((e) => ({ cell: e.cell, text: e.text, confidence: e.confidence, recoveredMark: !!e.recoveredMark })), singles: tsingles, error: merged?.error };
      }
    }
    return result;
  };
})();
