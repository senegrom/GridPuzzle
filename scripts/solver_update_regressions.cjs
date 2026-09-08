/* Real service-worker clients and cache storage across a two-tab update. */
const { chromium, webkit } = require("playwright");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const source = fs.readFileSync("web/sw.js", "utf8");
const first = "111111111111", second = "222222222222";
const reports = [];
let build = first, requests = [];
function files() {
  return {
    "index.html": "<!doctype html><title>Solver update regression</title>",
    "solver-worker.js": `let release;
    self.onmessage=async({data})=>{
      try {
        if(data==="release") { release(); return; }
        if(data==="start") await new Promise(resolve=>{
          release=resolve;
          self.postMessage({loading:true});
        });
        self.postMessage({debug:{controllerState:self.navigator.serviceWorker?.controller?.state, url:self.location.href}});
        const response=await fetch("./solver.${build}.zip");
        self.postMessage({status:response.status,body:await response.text()});
      } catch(error) { self.postMessage({error:error.message}); }
    };`,
    [`solver.${build}.zip`]: `verified solver ${build}`,
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
    "content-type": path.endsWith(".js") ? "application/javascript" : path.endsWith(".html") ? "text/html" : "application/octet-stream",
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
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    build = first;
    requests = [];
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/GridPuzzle/`;
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const report = { browser: name, version: browser.version(), errors: [] };
    reports.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    try {
      await page.goto(base);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("./sw.js");
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await page.evaluate(() => {
        window.results = [];
        window.workerDebug = [];
        window.originalController = navigator.serviceWorker.controller;
        window.solver = new Worker("./solver-worker.js", { type: "module" });
        window.solver.onmessage = ({ data }) => {
          if (data.loading) window.loading = true;
          else if (data.debug) window.workerDebug.push(data.debug);
          else window.results.push(data);
        };
        window.solver.postMessage("start");
      });
      // Pause in the worker itself: an outstanding fetch through the old
      // service worker would intentionally delay activation until it finishes.
      await page.waitForFunction(() => window.loading === true);
      const other = await context.newPage();
      await other.goto(base);
      build = second;
      await other.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await other.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
      await other.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: "ACTIVATE" }));
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
      assert.deepEqual(await page.evaluate(() => window.results[0]), { status: 200, body: `verified solver ${first}` });
      // Prove the same old URL remains available without any network fallback.
      await stopServer();
      await assert.rejects(fetch(base, { signal: AbortSignal.timeout(2000) }), "the origin is actually unreachable");
      await page.evaluate(() => window.solver.postMessage("again"));
      await page.waitForFunction(() => window.results.length === 2);
      assert.deepEqual(await page.evaluate(() => window.results[1]), { status: 200, body: `verified solver ${first}` });
      assert.deepEqual(report.errors, []);
      report.ok = true;
      report.checks = ["another tab activates while an old solver initializes", "old worker fetches its exact verified archive online and offline"];
    } catch (error) {
      report.ok = false;
      report.failure = error.stack;
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
