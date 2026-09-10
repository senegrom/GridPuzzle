import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function photoImports(t) {
  const nodes = new Map(), queue = [], errors = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: false });
    return nodes.get(id);
  };
  const originals = ["document", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.document = { addEventListener() {} };
  globalThis.Image = class {
    decode() {
      const next = queue.shift();
      next.started.resolve();
      return next.decode.promise;
    }
  };
  let epoch = 0;
  const stopTask = () => { epoch++; };
  setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask,
    getJobId: () => epoch,
    fail: (error) => errors.push(error.message),
  });
  return {
    errors, stopTask,
    async choose(id = "photo-file") {
      const request = { started: deferred(), decode: deferred() };
      queue.push(request);
      const input = { files: [new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,16])])], value: "photo" };
      const completed = $(id).onchange({ target: input });
      await request.started.promise;
      return { completed, reject: request.decode.reject, input };
    },
  };
}
test("active photo decode failures still report an error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  first.reject(Error("Image cannot be decoded"));
  await first.completed;
  assert.deepEqual(imports.errors, ["Image cannot be decoded"]);
  assert.equal(first.input.value, "");
});
test("cancelling a photo decode suppresses its delayed error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  imports.stopTask();
  first.reject(Error("Obsolete photo error"));
  await first.completed;
  assert.deepEqual(imports.errors, []);
});
test("an older native-photo failure cannot replace a newer import error", async (t) => {
  const imports = photoImports(t), first = await imports.choose("native-file"), second = await imports.choose();
  second.reject(Error("Current photo error"));
  await second.completed;
  first.reject(Error("Obsolete camera photo error"));
  await first.completed;
  assert.deepEqual(imports.errors, ["Current photo error"]);
});
