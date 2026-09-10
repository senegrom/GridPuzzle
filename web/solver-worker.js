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
let warming = null;
self.onmessage = async ({ data }) => {
  const { id, puzzle, type } = data;
  const status = (message) => self.postMessage({ id, type: "status", message });
  if (type === "warm") {
    // Load the runtime ahead of the first request. Failures are reported
    // without an id and simply leave the next solve to load it again.
    try {
      warming = warming || ensureRuntime(() => {});
      await warming;
      self.postMessage({ type: "ready" });
    } catch (error) {
      runtime = null;
      self.postMessage({ type: "warm-error", message: error.message || String(error) });
    } finally {
      warming = null;
    }
    return;
  }
  try {
    if (warming) await warming;
    await ensureRuntime(status);
    status("Solving and checking uniqueness…");
    runtime.globals.set("_browser_payload", JSON.stringify(puzzle));
    const result = JSON.parse(
      runtime.runPython("solve_json(_browser_payload)"),
    );
    runtime.globals.delete("_browser_payload");
    self.postMessage({ id, type: "result", result });
  } catch (error) {
    runtime = null;
    self.postMessage({
      id,
      type: "result",
      result: { status: "error", message: error.message || String(error) },
    });
  }
};
