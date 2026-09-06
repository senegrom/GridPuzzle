// No shared-memory headers, multiprocessing, Python rewriting, or remote solver.
let runtime;
self.onmessage = async ({ data: { id, puzzle } }) => {
  const status = (message) => self.postMessage({ id, type: "status", message });
  try {
    if (!runtime) {
      status("Loading Python on this device…");
      const { loadPyodide } = await import("./vendor/pyodide/pyodide.mjs");
      runtime = await loadPyodide({
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
      runtime.unpackArchive(await response.arrayBuffer(), "zip");
      runtime.runPython("from gridsolver.web_api import solve_json");
    }
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
