import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { Scanner } from "../scanner.js";
import { gray, threshold, thresholdGray } from "../geometry.js";

test("OCR cancellation terminates a child before initialization resolves", async () => {
  let child,
    terminated = 0;
  const messages = [];
  class Worker {
    constructor() {
      child = this;
    }
    terminate() {
      terminated++;
    }
  }
  const self = {
    Worker,
    location: { href: "https://example.test/GridPuzzle/ocr-host-worker.js" },
    postMessage: (m) => messages.push(m),
    close() {},
  };
  const context = vm.createContext({
    self,
    URL,
    Uint8Array,
    importScripts() {
      self.Tesseract = {
        createWorker: () => {
          new self.Worker();
          return new Promise(() => {});
        },
      };
    },
  });
  vm.runInContext(
    fs.readFileSync(new URL("../ocr-host-worker.js", import.meta.url), "utf8"),
    context,
  );
  void self.onmessage({ data: { png: new ArrayBuffer(0) } });
  assert.ok(child);
  await self.onmessage({ data: { cancel: true } });
  assert.equal(terminated, 1);
  assert.equal(messages.at(-1).cancelled, true);
});
test("scan cancellation rejects a pending worker request immediately", async () => {
  const old = globalThis.Worker;
  let instance;
  globalThis.Worker = class {
    constructor() {
      instance = this;
    }
    postMessage(m) {
      this.last = m;
    }
    terminate() {
      this.stopped = true;
    }
  };
  try {
    const scanner = new Scanner(),
      promise = scanner._request("ocr-host-worker.js", {}, () => {}, "classic");
    scanner.cancel();
    await assert.rejects(promise, { name: "AbortError" });
    assert.equal(scanner.jobs.size, 0);
    assert.equal(instance.last.cancel, true);
    instance.onmessage({ data: { cancelled: true } });
    assert.ok(instance.stopped);
  } finally {
    globalThis.Worker = old;
  }
});
test("shared grayscale threshold is byte-for-byte identical", () => {
  const image = {
    width: 41,
    height: 37,
    data: Uint8ClampedArray.from(
      { length: 41 * 37 * 4 },
      (_, i) => (i * 71) % 256,
    ),
  };
  assert.deepEqual(
    threshold(image),
    thresholdGray(gray(image), image.width, image.height),
  );
});
