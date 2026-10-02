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
      promise = scanner.ocr.recognize({});
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

test("late OCR progress is not a cancellation acknowledgement", async () => {
  const old = globalThis.Worker;
  let instance;
  globalThis.Worker = class {
    constructor() {
      instance = this;
    }
    postMessage() {}
    terminate() {
      this.stopped = true;
    }
  };
  try {
    const scanner = new Scanner(),
      promise = scanner.ocr.recognize({});
    scanner.cancel();
    await assert.rejects(promise, { name: "AbortError" });
    instance.onmessage({ data: { type: "progress", progress: 0.5 } });
    assert.ok(!instance.stopped);
    instance.onmessage({ data: { cancelled: true } });
    assert.ok(instance.stopped);
  } finally {
    globalThis.Worker = old;
  }
});
test("postMessage failure cannot retain workers or mask the original error", async () => {
  const old = globalThis.Worker,
    original = new DOMException("cannot clone", "DataCloneError");
  let instance;
  globalThis.Worker = class {
    constructor() {
      instance = this;
    }
    postMessage() {
      throw original;
    }
    terminate() {
      this.stopped = true;
    }
  };
  try {
    const scanner = new Scanner();
    await assert.rejects(
      scanner.ocr.recognize({}),
      (e) => e === original,
    );
    assert.equal(scanner.jobs.size, 0);
    assert.ok(instance.stopped);
  } finally {
    globalThis.Worker = old;
  }
});

for (const failure of ['error', 'messageerror', 'timeout', 'post', 'constructor']) {
  test(`geometry ${failure} releases owned work and can retry without the obsolete dispatch path`, async t => {
    const old = globalThis.Worker, workers = [];
    let broken = true;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.Worker = class {
      constructor() { if (failure === 'constructor' && broken) throw Error('constructor failed'); workers.push(this); }
      postMessage() { if (failure === 'post' && broken) throw Error('post failed'); }
      terminate() { this.stopped = true; }
    };
    const scanner = new Scanner();
    t.after(() => { scanner.cancel(); globalThis.Worker = old; });
    const pending = scanner.geometry('detect', {}), rejected = assert.rejects(pending);
    if (failure === 'error') workers[0].onerror({ message: 'worker error' });
    if (failure === 'messageerror') workers[0].onmessageerror();
    if (failure === 'timeout') t.mock.timers.tick(180000);
    await rejected; assert.equal(scanner.jobs.size, 0); assert.equal(scanner.geometryBusy, false);
    assert.ok(workers.every(w => w.stopped));
    broken = false;
    const next = scanner.geometry('detect', {}), worker = workers.at(-1);
    worker.onmessage({ data: { type: 'progress' } });
    assert.equal(scanner.jobs.size, 1, 'stray progress does not finish geometry');
    worker.onmessage({ data: { result: { rows: 2 } } });
    assert.deepEqual(await next, { rows: 2 }); assert.equal(scanner.jobs.size, 0);
  });
}
