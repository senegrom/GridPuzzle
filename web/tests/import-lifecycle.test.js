// Exercise the production import handlers with delayed file reads. Browser
// acceptance covers the same actions through real file inputs and dialogs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { makePuzzle, normalizePuzzle } from "../model.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const first = source.indexOf('$("json-file").onchange =');
const last = source.indexOf('const { stopCamera } =', first);
assert.ok(first >= 0 && last > first, "Production JSON handlers were not found");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness() {
  const nodes = new Map(), tasks = { id: 0 }, loaded = [], errors = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", files: [] });
    return nodes.get(id);
  };
  const stopTask = () => { tasks.id++; };
  vm.runInNewContext(source.slice(first, last), {
    $, tasks, stopTask,
    loadPuzzle(payload) {
      const p = normalizePuzzle(payload);
      stopTask(); loaded.push(p);
    },
    fail: (error) => errors.push(error.message),
  });
  const choose = (file) => {
    $("json-file").files = file ? [file] : [];
    return $("json-file").onchange({ target: $("json-file") });
  };
  return { $, tasks, loaded, errors, choose };
}
const valid = JSON.stringify(makePuzzle("latinsquare", 2));
for (const late of ["success", "error"]) {
  for (const newer of ["oversized file", "oversized draft", "invalid JSON draft", "invalid puzzle draft"]) {
    test(`rejecting a newer ${newer} supersedes an older import's delayed ${late}`, async () => {
      const h = harness(), old = deferred();
      const pending = h.choose({ size: 100, text: () => old.promise });
      if (newer === "oversized file")
        await h.choose({ size: 200001, text() { throw Error("Must not read oversized file"); } });
      else {
        h.$("json-data").value = newer === "oversized draft" ? "x".repeat(200001)
          : newer === "invalid JSON draft" ? "{" : '{"type":"auto"}';
        h.$("apply-json").onclick();
      }
      assert.equal(h.errors.length, 1);
      const error = h.errors[0];
      if (late === "success") old.resolve(valid);
      else old.reject(Error("Obsolete file failed"));
      await pending;
      assert.deepEqual(h.loaded, [], "A rejected new import must not resurrect an older one");
      assert.deepEqual(h.errors, [error], "A stale failure must not replace the newer error");
    });
  }
}
test("cancelling the file picker does not supersede an import already loading", async () => {
  const h = harness(), old = deferred();
  const pending = h.choose({ size: 100, text: () => old.promise });
  const generation = h.tasks.id;
  await h.choose(null);
  assert.equal(h.tasks.id, generation);
  old.resolve(valid); await pending;
  assert.equal(h.loaded.length, 1); assert.deepEqual(h.errors, []);
});
test("a valid replacement import wins regardless of an older read completing last", async () => {
  const h = harness(), old = deferred();
  const pending = h.choose({ size: 100, text: () => old.promise });
  await h.choose({ size: 100, text: async () => JSON.stringify(makePuzzle("latinsquare", 3)) });
  old.resolve(valid); await pending;
  assert.deepEqual(h.loaded.map((p) => p.rows), [3]);
});
