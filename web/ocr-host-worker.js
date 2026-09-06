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
        if (m.status === "recognizing text")
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
    await worker.terminate();
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  } finally {
    stopChildren();
  }
};
