/* Classic, per-scan host: owns raw OCR workers from construction onward. */
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
self.onmessage = async ({ data }) => {
  if (data.cancel) {
    stopChildren();
    self.postMessage({ cancelled: true });
    self.close();
    return;
  }
  let phase = "atlas";
  try {
    importScripts(local("./vendor/tesseract/tesseract.min.js"));
    const worker = await self.Tesseract.createWorker("eng", 1, {
      workerPath: local("./vendor/tesseract/worker.min.js"),
      corePath: local("./vendor/tesseract-core/"),
      langPath: local("./vendor/tessdata/").replace(/\/$/, ""),
      workerBlobURL: false,
      errorHandler: (error) => {
        stopChildren();
        self.postMessage({ error: String(error) });
      },
      logger: (m) => {
        if (m.status === "recognizing text" && phase === "atlas")
          self.postMessage({
            type: "progress",
            message: "Reading printed clues…",
            progress: m.progress,
          });
      },
    });
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
        const next = samples[i].psm === "7" ? "7" : "10";
        if (psm !== next) {
          await worker.setParameters({ tessedit_pageseg_mode: next });
          psm = next;
        }
        const { data: read } = await worker.recognize(
          samples[i].png,
          {},
          { text: true, blocks: true },
        );
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
            type: "progress",
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
    let retries = 0;
    for (const [index, reads] of groups) {
      if (retries >= 24) break;
      if (reads.length < 2 || (reads.every((r) => /^\d{1,3}$/.test(r.text)) && reads.every((r) => r.text === reads[0].text))) continue;
      const sample = samples.find((s) => s.index === index && s.kind === "gray");
      if (!sample) continue;
      if (!retries) await worker.setParameters({ tessedit_pageseg_mode: "13" });
      const { data: read } = await worker.recognize(sample.png, {}, { text: true, blocks: true });
      singles.push({ index, kind: "retry", text: (read.text || "").replace(/\s/g, ""), confidence: read.confidence || 0 });
      retries++;
    }
    result.retryCount = retries;
    result.singles = singles;
    await worker.terminate();
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  } finally {
    stopChildren();
  }
};
