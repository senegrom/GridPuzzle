/* A page left on the previous build after a deploy, with the real service
   worker, OCR and update banner. GitHub Pages replaces the whole site, so
   build X's versioned URLs (vendor/X/, solver.X.zip, solver-worker.X.js)
   return 404 after the next deploy, while worker X keeps serving page X until
   the user chooses "Update app & reload" (web/README.md, "Offline
   behaviour"). The server here serves the built site as X, then as a later
   build: X's files under that build's names, restamped as build_web.py
   stamps them, and that build's own asset list. The tab stays open across
   both deploys, neither navigated nor asking the browser to look for an
   update, so only worker X's own check, when it meets the deploy, can bring
   the banner. Part of photo_read_regressions.cjs. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { PHONE, sleep } = require("./harness.cjs");

const SITE = path.resolve("_site");
const PHOTO = path.resolve("Examples/BrowserScanner/Newspaper/2026-09-07-sudoku.webp");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".zip": "application/zip",
  ".gz": "application/gzip", ".txt": "text/plain; charset=utf-8" };
// What build_web.py stamps with the build: text outside vendor/.
const STAMPED = new Set([".html", ".js", ".css", ".svg", ".webmanifest", ".json", ".txt"]);
const ADVICE = "An updated version of the app is ready. Use “Update app & reload”, then";

function origin() {
  const X = JSON.parse(fs.readFileSync(path.join(SITE, "build-info.json"), "utf8")).build;
  let deployed = { build: X, changed: new Set() }, manifest = null;
  const file = (rel) => {
    const full = path.resolve(SITE, rel);
    return full.startsWith(SITE + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full) : null;
  };
  // What the deployed build serves at `rel`.
  function bytes(rel) {
    const { build, changed } = deployed;
    if (build === X) return file(rel);
    if (rel === "assets.json") return manifest;
    if (rel.startsWith(`vendor/${X}/`) || rel === `solver.${X}.zip` || rel === `solver-worker.${X}.js`) return null;
    const source = rel.startsWith(`vendor/${build}/`) ? `vendor/${X}/${rel.slice(`vendor/${build}/`.length)}`
      : rel === `solver.${build}.zip` ? `solver.${X}.zip` : rel === `solver-worker.${build}.js` ? `solver-worker.${X}.js` : rel;
    let data = file(source);
    if (!data) return null;
    if (!source.startsWith("vendor/") && STAMPED.has(path.extname(rel))) data = Buffer.from(data.toString("utf8").split(X).join(build));
    // A vendored file of another version: the same file with other bytes.
    return changed.has(rel) ? Buffer.concat([data, Buffer.from(`\n/* as shipped by ${build} */\n`)]) : data;
  }
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, "http://localhost");
    const rel = pathname.startsWith("/GridPuzzle/") ? decodeURIComponent(pathname.slice("/GridPuzzle/".length)) || "index.html" : null;
    const body = rel === null ? null : bytes(rel);
    if (!body) { response.writeHead(404, { "content-type": "text/plain" }); response.end("Not found"); return; }
    // GitHub Pages lets browsers keep every file for ten minutes.
    response.writeHead(200, { "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream", "cache-control": "max-age=600" });
    response.end(body);
  });
  return {
    X, server,
    // From now on the origin serves only `build`, whose files are X's but
    // for those in `changed` (paths under `build`).
    deploy(build, changed = []) {
      deployed = { build, changed: new Set(changed) };
      const assets = JSON.parse(file("assets.json")).assets.map(({ path: from }) => {
        const to = from.split(X).join(build), data = bytes(to);
        return { path: to, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
      });
      manifest = Buffer.from(JSON.stringify({ build, assets }) + "\n");
    },
  };
}

async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]', { timeout: 120000 });
  await page.evaluate(async () => { window.__staleState = (await import("./app.js")).getState; });
}
const pageBuild = (page) => page.evaluate(() => document.getElementById("build-label").textContent.split(" · ").at(-1));
// `build` installed and waiting, and the banner offering it. Nothing here
// asks the browser to look for it: worker X does, when a file it misses
// leads it to the origin's list of another build (sw.js, requestUpdate()).
async function updateFound(page, build) {
  const end = Date.now() + 90000;
  for (;;) {
    const state = await page.evaluate(async (build) => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { waiting: Boolean(registration.waiting), installing: Boolean(registration.installing),
        stored: (await caches.keys()).some((name) => name.endsWith(`:meta:${build}`)),
        banner: !document.getElementById("update-banner").hidden };
    }, build);
    if (state.waiting && !state.installing && state.stored && state.banner) return;
    if (Date.now() > end) throw Error(`build ${build} was not found waiting: ${JSON.stringify(state)}`);
    await sleep(250);
  }
}
async function choosePhoto(page) {
  await page.evaluate(() => { document.getElementById("auto-solve").checked = false; });
  await page.setInputFiles("#photo-file", PHOTO);
  await page.waitForFunction(() => /Grid found|Set the four crop corners/.test(document.getElementById("status-text").textContent),
    null, { timeout: 120000 });
}
async function read(page) {
  await page.evaluate(() => {
    const node = document.getElementById("status-text");
    window.__staleLog = [];
    window.__staleObserver?.disconnect();
    window.__staleObserver = new MutationObserver(() => window.__staleLog.push(node.textContent));
    window.__staleObserver.observe(node, { childList: true, characterData: true, subtree: true });
  });
  await page.click("#read-photo");
  await page.waitForFunction(() => window.__staleLog.length > 0 && !window.__staleState().busy, null, { timeout: 180000 });
  return page.evaluate(() => ({
    status: document.getElementById("status").className,
    text: document.getElementById("status-text").textContent,
    clues: window.__staleState().puzzle.cells.filter(Number.isInteger).length,
  }));
}
async function prepareOffline(page) {
  await page.locator("#prepare-offline").evaluate((button) => { button.closest("details").open = true; });
  await page.click("#prepare-offline");
  await page.waitForFunction(() => {
    const text = document.getElementById("offline-state").textContent;
    return !document.getElementById("prepare-offline").disabled && !/^Downloading/.test(text);
  }, null, { timeout: 180000 });
  return page.textContent("#offline-state");
}

async function staleBuild(browser, report) {
  const site = origin(), started = Date.now();
  await new Promise((resolve) => site.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${site.server.address().port}/GridPuzzle/`;
  const context = await browser.newContext({ ...PHONE, serviceWorkers: "allow" });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  const result = report.staleBuild = { build: site.X };
  try {
    // An installed app that never read a photo: its worker stores no OCR.
    await page.goto(base); await ready(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 120000 });
    await page.reload(); await ready(page);
    // From here on the tab is kept open: a navigation would end this mark.
    await page.evaluate(() => { window.__staleTab = true; });
    const kept = () => page.evaluate(() => window.__staleTab === true);
    const seconds = (since) => Math.round((Date.now() - since) / 100) / 10;
    // A deploy of another OCR runtime: nothing identical to X's remains.
    const changed = "feedbeef0001", unchanged = "feedbeef0002";
    site.deploy(changed, [`vendor/${changed}/tesseract/tesseract.min.js`]);
    await choosePhoto(page);
    assert.equal(await page.isHidden("#update-banner"), true, "nothing has found the deploy yet");
    // The first read misses X's OCR runtime, which makes worker X ask for
    // the deploy's worker, and fails before that worker is installed.
    const first = await read(page);
    assert.equal(first.status, "status error", JSON.stringify(first));
    const failedAt = Date.now();
    await updateFound(page, changed);
    const bannerSeconds = seconds(failedAt);
    assert.ok(await kept(), "the update is offered in the open tab");
    assert.equal(await pageBuild(page), site.X, "the page keeps its build until the user updates");
    const failed = await read(page);
    assert.equal(failed.status, "status error");
    assert.equal(failed.text, `Recognition could not load. ${ADVICE} try again.`);
    assert.equal(await prepareOffline(page),
      `Some of this version’s files are no longer on the server. ${ADVICE} download for offline use again.`);
    result.runtimeChanged = { firstRead: first.text, bannerSeconds, read: failed.text, offline: true };
    // A later deploy with X's OCR runtime under its own URLs: page X reads,
    // while worker X, finding that build on the origin, has it installed.
    site.deploy(unchanged);
    const stale = await read(page);
    assert.equal(stale.text, "Puzzle read.", JSON.stringify(stale));
    assert.ok(stale.clues >= 20, `only ${stale.clues} clues were read`);
    const readAt = Date.now();
    await updateFound(page, unchanged);
    const updateSeconds = seconds(readAt);
    assert.ok(await kept());
    assert.equal(await pageBuild(page), site.X);
    assert.match(await prepareOffline(page), /^Offline assets are ready on this device/);
    result.runtimeUnchanged = { clues: stale.clues, updateSeconds, offline: true };
    // The offered update: the updated page reads the photo too.
    await Promise.all([page.waitForNavigation({ timeout: 120000 }), page.click("#update-banner-button")]);
    await ready(page);
    assert.equal(await pageBuild(page), unchanged);
    await choosePhoto(page);
    const updated = await read(page);
    assert.equal(updated.text, "Puzzle read.", JSON.stringify(updated));
    result.updated = { clues: updated.clues };
    result.seconds = Math.round((Date.now() - started) / 1000);
  } finally {
    await context.close();
    site.server.closeAllConnections?.();
    await new Promise((resolve) => site.server.close(resolve));
  }
}
module.exports = { staleBuild };
