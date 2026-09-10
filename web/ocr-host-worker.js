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
    // Second pass: every digit crop on its own as a single character. The
    // readings are independent of the atlas layout and vote in the scanner.
    const singles = [],
      samples = Array.isArray(data.singles) ? data.singles : [];
    if (samples.length) {
      phase = "singles";
      await worker.setParameters({
        tessedit_pageseg_mode: "10",
        tessedit_char_whitelist: "0123456789",
      });
      for (let i = 0; i < samples.length; i++) {
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
    result.singles = singles;
    await worker.terminate();
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  } finally {
    stopChildren();
  }
};
