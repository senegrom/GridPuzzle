/* Real service-worker clients and cache storage across a two-tab update. */
const { chromium, webkit } = require("playwright");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const source = fs.readFileSync("web/sw.js", "utf8");
const first = "111111111111", second = "222222222222";
const reports = [];
let build = first, requests = [], legacy = false;
const runtimeRoot = () => legacy && build === first ? "vendor/pyodide/" : `vendor/${build}/pyodide/`;
function expected(version) {
  return { status: 200, body: `verified solver ${version}`, runtime: {
    tag: version, wasm: `wasm ${version}`, stdlib: `stdlib ${version}`, lock: `lock ${version}`,
  } };
}
function files() {
  const worker = `let release;
    self.onmessage=async({data})=>{
      try {
        if(data==="release") { release(); return; }
        if(data==="start") await new Promise(resolve=>{
          release=resolve;
          self.postMessage({loading:true});
        });
        self.postMessage({debug:{controllerState:self.navigator.serviceWorker?.controller?.state, url:self.location.href}});
        const {bytes}=await import("./${runtimeRoot()}pyodide.mjs");
        const runtime=await bytes();
        const response=await fetch("./solver.${build}.zip");
        self.postMessage({status:response.status,body:await response.text(),runtime});
      } catch(error) { self.postMessage({error:error.message}); }
    };`;
  return {
    "index.html": `<!doctype html><title>Solver update ${build}</title>`,
    "solver-worker.js": worker,
    [`solver-worker.${build}.js`]: worker,
    [`solver.${build}.zip`]: `verified solver ${build}`,
    // This module is byte-identical across builds. Its relative imports and
    // fetches must still resolve in the REQUESTED build's directory after
    // the digest cache reuses its Response from the previous URL.
    [runtimeRoot() + "pyodide.mjs"]: `export async function bytes() {
      const {tag}=await import("./pyodide.asm.mjs");
      const read=async path=>(await fetch(new URL(path,import.meta.url))).text();
      return {tag,wasm:await read("./pyodide.asm.wasm"),stdlib:await read("./python_stdlib.zip"),lock:await read("./pyodide-lock.json")};
    }`,
    [runtimeRoot() + "pyodide.asm.mjs"]: `export const tag="${build}";`,
    [runtimeRoot() + "pyodide.asm.wasm"]: `wasm ${build}`,
    [runtimeRoot() + "python_stdlib.zip"]: `stdlib ${build}`,
    [runtimeRoot() + "pyodide-lock.json"]: `lock ${build}`,
  };
}
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const path = pathname.replace(/^\/GridPuzzle\//, "") || "index.html";
  requests.push({ build, path });
  const assets = files();
  let body;
  if (path === "sw.js") body = source.replace("__BUILD_ID__", build);
  else if (path === "assets.json") body = JSON.stringify({ build, assets: Object.entries(assets).map(([path, data]) => ({
    path, bytes: Buffer.byteLength(data), sha256: createHash("sha256").update(data).digest("hex"),
  })) });
  else body = assets[path];
  if (body === undefined) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, {
    "content-type": /\.(?:m?js)$/.test(path) ? "application/javascript" : path.endsWith(".html") ? "text/html" : "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(body);
});
async function stopServer() {
  if (!server.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
(async () => {
  for (const [name, engine, oldLayout] of Object.entries({ chromium, webkit }).flatMap(([name, engine]) => [[name, engine, "versioned"], [name, engine, "legacy"]])) {
    legacy = oldLayout === "legacy";
    build = first;
    requests = [];
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/GridPuzzle/`;
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const report = { browser: name, version: browser.version(), oldLayout, errors: [] };
    reports.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    try {
      await page.goto(base);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("./sw.js");
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      // Model an existing installed app: its document navigation, not just
      // a subsequent claim(), must already have gone through the old worker.
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
      await page.evaluate((script) => {
        window.results = [];
        window.workerDebug = [];
        window.originalController = navigator.serviceWorker.controller;
        window.solver = new Worker(script, { type: "module" });
        window.solver.onmessage = ({ data }) => {
          if (data.loading) window.loading = true;
          else if (data.debug) window.workerDebug.push(data.debug);
          else window.results.push(data);
        };
        window.solver.postMessage("probe");
      }, legacy ? "./solver-worker.js" : `./solver-worker.${first}.js`);
      await page.waitForFunction(() => window.results.length === 1);
      assert.deepEqual(await page.evaluate(() => window.results[0]), expected(first));
      assert.equal(requests.filter((request) => request.path === `solver.${first}.zip`).length, 1, "the pre-update worker uses the verified cache, not the origin");
      await page.evaluate(() => { window.results = []; window.workerDebug = []; window.solver.postMessage("start"); });
      // Pause in the worker itself: an outstanding fetch through the old
      // service worker would intentionally delay activation until it finishes.
      await page.waitForFunction(() => window.loading === true);
      const other = await context.newPage();
      await other.goto(base);
      build = second;
      await other.evaluate(async () => {
        window.outgoingController = navigator.serviceWorker.controller;
        window.updateRegistration = await navigator.serviceWorker.getRegistration();
        await window.updateRegistration.update();
      });
      await other.waitForFunction(() => {
        // Keep this predicate synchronous: a Promise is truthy to the polling
        // helper even when it later resolves to false while install is pending.
        const waiting = window.updateRegistration.waiting;
        if (waiting) { waiting.postMessage({ type: "ACTIVATE" }); return true; }
        return navigator.serviceWorker.controller !== window.outgoingController;
      });
      await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller !== window.originalController);
      // Resume as soon as control changes to cover requests racing activation.
      await page.evaluate(() => window.solver.postMessage("release"));
      await page.waitForFunction(() => window.results.length === 1);
      // controllerchange precedes the activate event's waitUntil work. Read
      // diagnostic metadata only once that migration has actually completed.
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
      report.retained = await page.evaluate(async () => {
        const key = (await caches.keys()).find((key) => key.endsWith("meta:222222222222"));
        const cache = await caches.open(key);
        return (await cache.match(new URL(".retained-solvers.json", location.href))).json();
      });
      assert.deepEqual(await page.evaluate(() => window.results[0]), expected(first));
      if (legacy) {
        // The claimed old tab also routes unversioned dependencies through
        // the new controller, not just through the old worker's controller.
        assert.equal(await page.evaluate(async () => (await fetch("./vendor/pyodide/pyodide.asm.wasm")).text()), `wasm ${first}`);
      }
      await other.reload();
      await other.evaluate((script) => {
        window.results=[];
        window.solver=new Worker(script,{type:"module"});
        window.solver.onmessage=({data})=>{if(!data.debug&&!data.loading)window.results.push(data);};
        window.solver.postMessage("probe");
      }, `./solver-worker.${second}.js`);
      await other.waitForFunction(() => window.results.length === 1);
      assert.deepEqual(await other.evaluate(() => window.results[0]), expected(second));
      // Prove the same old URL remains available without any network fallback.
      await stopServer();
      await assert.rejects(fetch(base, { signal: AbortSignal.timeout(2000) }), "the origin is actually unreachable");
      await page.evaluate(() => window.solver.postMessage("again"));
      await page.waitForFunction(() => window.results.length === 2);
      assert.deepEqual(await page.evaluate(() => window.results[1]), expected(first));
      await other.evaluate(() => window.solver.postMessage("again"));
      await other.waitForFunction(() => window.results.length === 2);
      assert.deepEqual(await other.evaluate(() => window.results[1]), expected(second));
      assert.deepEqual(report.errors, []);
      report.ok = true;
      report.checks = [
        "another tab activates while an old solver initializes",
        "old and new workers keep their exact archive, WASM, stdlib and lock files online and offline",
        "a reused module response resolves relative dependencies against its requested versioned URL",
        `${oldLayout} outgoing worker migration`,
      ];
    } catch (error) {
      report.ok = false;
      report.failure = error.stack;
      report.requests = [...requests];
      report.results = await page.evaluate(() => window.results).catch(() => null);
      report.workerDebug = await page.evaluate(() => window.workerDebug).catch(() => null);
      console.error(name, error);
      console.error(JSON.stringify({ retained: report.retained, workerDebug: report.workerDebug, requests }));
    } finally {
      await browser.close();
      await stopServer();
    }
  }
  if (reports.some((report) => !report.ok)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.mkdirSync("browser-artifacts", { recursive: true });
  fs.writeFileSync("browser-artifacts/solver-update-regressions.json", JSON.stringify(reports, null, 2));
  server.close();
});
