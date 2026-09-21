// No shared-memory headers, multiprocessing, Python rewriting, or remote solver.
let runtime;
async function ensureRuntime(status) {
  if (runtime) return;
  status("Loading Python on this device…");
  const { loadPyodide } = await import("./vendor/pyodide/pyodide.mjs");
  const loaded = await loadPyodide({
    indexURL: new URL("./vendor/pyodide/", self.location.href).href,
    stdout: () => {},
    stderr: () => {},
  });
  status("Loading the complete GridPuzzle solver…");
  const response = await fetch("./solver.zip");
  if (!response.ok)
    throw Error(
      `Solver download failed (${response.status}). Go online and retry.`,
    );
  loaded.unpackArchive(await response.arrayBuffer(), "zip");
  loaded.runPython("from gridsolver.web_api import solve_json");
  runtime = loaded;
}
// One load at a time: a solve arriving during warm-up, or two solves before
// the runtime is ready, share the same download instead of starting another.
let loading = null;
const load = (status) =>
  (loading ??= ensureRuntime(status).finally(() => { loading = null; }));
self.onmessage = async ({ data }) => {
  const { id, puzzle, type } = data;
  const status = (message) => self.postMessage({ id, type: "status", message });
  if (type === "warm") {
    // Load the runtime ahead of the first request. Failures are reported
    // without an id and simply leave the next solve to load it again.
    try {
      await load(() => {});
      self.postMessage({ type: "ready" });
    } catch (error) {
      runtime = null;
      self.postMessage({ type: "warm-error", message: error.message || String(error) });
    }
    return;
  }
  let ready = false;
  try {
    await load(status);
    ready = true;
    status("Solving and checking uniqueness…");
    runtime.globals.set("_browser_payload", JSON.stringify(puzzle));
    let text;
    try {
      text = runtime.runPython("solve_json(_browser_payload)");
    } finally {
      runtime.globals.delete("_browser_payload");
    }
    self.postMessage({ id, type: "result", result: JSON.parse(text) });
  } catch (error) {
    // A Python exception leaves the interpreter healthy, so keep it. Only a
    // runtime that failed to load, or a JavaScript-side failure, is discarded
    // so that the next request loads a fresh interpreter.
    if (!ready || error?.name !== "PythonError") runtime = null;
    self.postMessage({
      id,
      type: "result",
      result: { status: "error", message: error.message || String(error) },
    });
  }
};
