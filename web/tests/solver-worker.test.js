// solver-worker.js: interpreter reuse after a Python error, retry after a failed
// load, and one shared load for a warm-up and the solve that follows it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// --- solver worker: runtime survival ---------------------------------------
function workerHarness({ pythonError = false, loadFails = false } = {}) {
  const source = fs.readFileSync(new URL("../solver-worker.js", import.meta.url), "utf8")
    .replace('await import("./vendor/pyodide/pyodide.mjs")', "await self.__pyodideModule()");
  const messages = [], globals = new Map();
  let loads = 0, deletes = 0;
  const runtime = {
    globals: { set: (k, v) => globals.set(k, v), delete: (k) => { deletes++; globals.delete(k); } },
    unpackArchive() {},
    runPython(code) {
      if (code.startsWith("from ")) return;
      if (pythonError) { const error = Error("ZeroDivisionError: division by zero"); error.name = "PythonError"; error.type = "ZeroDivisionError"; throw error; }
      return JSON.stringify({ status: "unique", solutions: [], complete: true });
    },
  };
  const self = { location: { href: "https://example.test/solver-worker.js" }, postMessage: (m) => messages.push(m),
    __pyodideModule: async () => ({ loadPyodide: async () => { loads++; return runtime; } }) };
  const context = vm.createContext({ self, URL, JSON, fetch: async () => ({ ok: !loadFails, status: loadFails ? 503 : 200, arrayBuffer: async () => new ArrayBuffer(0) }) });
  vm.runInContext(source, context);
  return { self, messages, get loads() { return loads; }, get deletes() { return deletes; }, globals,
    async solve(id) { await self.onmessage({ data: { id, puzzle: { type: "sudoku" } } }); return messages.findLast((m) => m.type === "result" && m.id === id).result; } };
}

test("a Python exception keeps the loaded interpreter and clears the payload", async () => {
  const h = workerHarness({ pythonError: true });
  assert.equal((await h.solve(1)).status, "error");
  assert.equal(h.loads, 1);
  assert.equal(h.deletes, 1, "the payload global is released even when Python throws");
  assert.equal((await h.solve(2)).status, "error");
  assert.equal(h.loads, 1, "the runtime is not reloaded after a Python exception");
});

test("a runtime that failed to load is retried on the next request", async () => {
  const h = workerHarness({ loadFails: true });
  assert.match((await h.solve(1)).message, /Solver download failed/);
  assert.equal(h.loads, 1);
  assert.match((await h.solve(2)).message, /Solver download failed/);
  assert.equal(h.loads, 2);
});

test("a solve during warm-up shares the warm-up's load instead of starting another", async () => {
  const h = workerHarness();
  const warm = h.self.onmessage({ data: { type: "warm" } });
  const solve = h.self.onmessage({ data: { id: 7, puzzle: { type: "sudoku" } } });
  await Promise.all([warm, solve]);
  assert.equal(h.loads, 1);
  assert.ok(h.messages.some((m) => m.type === "ready"));
  assert.equal(h.messages.findLast((m) => m.type === "result").result.status, "unique");
});
