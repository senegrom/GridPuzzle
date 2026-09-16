/* Classic reusable host: owns raw OCR workers from construction onward. */
const children = new Set(),
  NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args);
    children.add(this);
  }
  terminate() {
    children.delete(this);
    super.terminate();
  }
};
function stopChildren() {
  for (const child of children) child.terminate();
}
const local = (path) => new URL(path, self.location.href).href;
let enginePromise = null, phase = "atlas", current = null;
const cache = new Map();
let cacheBytes = 0;
function cached(key) {
  const value = cache.get(key);
  if (value) { cache.delete(key); cache.set(key, value); }
  return value;
}
function remember(key, value) {
  if (key.length > 100000 || cache.has(key)) return;
  cache.set(key, value); cacheBytes += key.length * 2;
  while (cache.size > 256 || cacheBytes > 2_000_000) {
    const first = cache.keys().next().value;
    cacheBytes -= first.length * 2; cache.delete(first);
  }
}
function engine() {
  if (!enginePromise) enginePromise = (async () => {
    importScripts(local("./vendor/tesseract/tesseract.min.js"));
    return await self.Tesseract.createWorker("eng", 1, {
      workerPath: local("./vendor/tesseract/worker.min.js"),
      corePath: local("./vendor/tesseract-core/"),
      langPath: local("./vendor/tessdata/").replace(/\/$/, ""),
      workerBlobURL: false,
      errorHandler: (error) => {
        stopChildren();
        self.postMessage({ error: String(error), fatal: true });
      },
      logger: (m) => {
        if (m.status === "recognizing text" && phase === "atlas")
          self.postMessage({
            id: current?.id, type: "progress",
            message: "Reading printed clues…",
            progress: m.progress,
          });
      },
    });
  })();
  return enginePromise;
}
async function recognize(data, check) {
  let calls = 1, cacheHits = 0;
  const worker = await engine();
  check(); phase = "atlas";
    await worker.setParameters({
      tessedit_pageseg_mode: "11",
      tessedit_char_whitelist: "0123456789<>^vV+-xX*/=×÷",
      user_defined_dpi: "300",
    });
    const { data: result } = await worker.recognize(
      new Uint8Array(data.png),
      {},
      { text: true, blocks: true },
    );
    check();
    if (data.keepAlive) self.postMessage({ id: data.id, type: "atlas", result });
    // Read numeric crops independently of the atlas layout. Narrow glyphs
    // use character mode; wide numbers use line mode to keep all digits.
    const singles = [],
      samples = Array.isArray(data.singles) ? data.singles : [];
    if (samples.length) {
      phase = "singles";
      await worker.setParameters({
        tessedit_pageseg_mode: "10",
        tessedit_char_whitelist: "0123456789",
      });
      let psm = "10";
      for (let i = 0; i < samples.length; i++) {
        check();
        const next = samples[i].psm === "7" ? "7" : "10";
        if (psm !== next) {
          await worker.setParameters({ tessedit_pageseg_mode: next });
          psm = next;
        }
        const key = next + ":" + samples[i].png;
        let read = cached(key);
        if (read) cacheHits++;
        else {
          ({ data: read } = await worker.recognize(samples[i].png, {}, { text: true, blocks: true }));
          calls++;
          check();
          remember(key, read);
        }
        const symbols = (read.blocks || []).flatMap((b) =>
          (b.paragraphs || []).flatMap((p) =>
            (p.lines || []).flatMap((l) =>
              (l.words || []).flatMap((w) => w.symbols || []),
            ),
          ),
        );
        singles.push({
          index: samples[i].index,
          kind: samples[i].kind,
          text: (symbols.length
            ? symbols.map((s) => s.text).join("")
            : read.text || ""
          ).replace(/\s/g, ""),
          confidence: symbols.length
            ? Math.min(...symbols.map((s) => s.confidence))
            : read.confidence || 0,
        });
        if (i % 8 === 7)
          self.postMessage({
            id: data.id, type: "progress",
            message: "Checking printed clues…",
            progress: (i + 1) / samples.length,
          });
      }
    }
    // A bounded extra segmentation pass targets only numeric crops whose two
    // independent reads disagree or contain a miss. Raw-line mode bypasses
    // Tesseract's word/character segmentation assumptions. No solver values,
    // substitutions, dictionaries or reference answers enter recognition.
    const groups = new Map();
    for (const reading of singles) {
      if (!groups.has(reading.index)) groups.set(reading.index, []);
      groups.get(reading.index).push(reading);
    }
    let retries = 0, segmentReads = 0;
    const jobs = [...groups].map(([index, reads]) => {
      const sample = samples.find((s) => s.index === index && s.kind === "gray"),
        segments = Array.isArray(sample?.segments) && sample.segments.length >= 2 &&
          sample.segments.length <= 3 && sample.segments.every((png) => typeof png === "string" && png)
          ? sample.segments : [];
      return { index, reads, sample, segments,
        agrees: reads.length >= 2 && reads.every((r) => /^\d{1,3}$/.test(r.text)) &&
          reads.every((r) => r.text === reads[0].text) };
    });
    const raw = async (png) => {
      check();
      if (!retries) await worker.setParameters({ tessedit_pageseg_mode: "13" });
      const key = "13:" + png;
      let read = cached(key);
      if (read) cacheHits++;
      else {
        ({ data: read } = await worker.recognize(png, {}, { text: true, blocks: true }));
        calls++; check(); remember(key, read);
      }
      retries++;
      return { text: (read.text || "").replace(/\s/g, ""), confidence: read.confidence || 0 };
    };
    // Reserve the original retries first, in their original order. A hard
    // image must not lose an existing recovery because an earlier glyph used
    // up the shared budget on the new fallback.
    for (const job of jobs) {
      check();
      if (retries >= 24) break;
      if (job.reads.length < 2 || job.agrees || !job.sample) continue;
      job.retry = await raw(job.sample.png);
      singles.push({ index: job.index, kind: "retry", ...job.retry });
    }
    for (const job of jobs) {
      check();
      if (retries >= 24) break;
      const { index, reads, sample, segments } = job;
      if (!segments.length || reads.length < 2 || !sample) continue;
      const complete = (r) => r && /^\d{1,3}$/.test(r.text) && r.text.length === segments.length;
      if ([...reads, job.retry].some(complete)) continue;
      // False agreement on a truncated number still gets a whole-crop retry.
      if (!job.retry) {
        job.retry = await raw(sample.png);
        singles.push({ index, kind: "retry", ...job.retry });
        if (complete(job.retry)) continue;
      }
      // Only recover missing/truncated numbers from non-overlapping glyph
      // boxes, within the SAME 24-call retry ceiling. Never assemble a prefix.
      if (retries + segments.length > 24) continue;
      const parts = [];
      for (const png of segments) {
        const part = await raw(png);
        segmentReads++;
        if (!/^\d$/.test(part.text)) break;
        parts.push(part);
      }
      if (parts.length === segments.length)
        singles.push({ index, kind: "segments", text: parts.map((p) => p.text).join(""),
          confidence: Math.min(...parts.map((p) => p.confidence)) });
    }
    result.retryCount = retries;
    result.singles = singles;
    result.ocrStats = { calls, cacheHits, samples: samples.length, segmentReads };
    check();
    return result;

}
self.onmessage = async ({ data }) => {
  if (data.cancel === true) {
    if (current) current.cancelled = true;
    stopChildren(); enginePromise = null; cache.clear(); cacheBytes = 0;
    self.postMessage({ cancelled: true }); self.close(); return;
  }
  if (Number.isInteger(data.cancel)) {
    if (current?.id === data.cancel) current.cancelled = true;
    return;
  }
  if (data.type === "warm") {
    try { await engine(); self.postMessage({ type: "ready" }); }
    catch (error) { stopChildren(); enginePromise = null; self.postMessage({ error: error.message || String(error), fatal: true }); }
    return;
  }
  if (current) { self.postMessage({ id: data.id, error: "OCR is still finishing an earlier request." }); return; }
  const job = { id: data.id, cancelled: false }; current = job;
  const check = () => { if (job.cancelled) throw Error("Scan cancelled"); };
  try {
    const result = await recognize(data, check);
    check();
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage(job.cancelled ? { id: data.id, cancelled: true }
      : { id: data.id, error: error.message || String(error) });
    if (!job.cancelled) { stopChildren(); enginePromise = null; cache.clear(); cacheBytes = 0; }
  } finally {
    if (!data.keepAlive) {
      try { if (enginePromise) await (await enginePromise).terminate(); } catch { /* construction may fail */ }
      stopChildren(); enginePromise = null; cache.clear(); cacheBytes = 0;
    }
    if (current === job) current = null;
  }
};
