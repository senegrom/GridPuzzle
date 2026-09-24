import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { downloadBlob, DOWNLOAD_URL_LIFETIME } from "../download.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { setupDiagnosticsUI } from "../diagnostics-ui.js";

function browser(t) {
  const created = [], revoked = [], clicks = [];
  const previous = { URL: globalThis.URL, document: globalThis.document, window: globalThis.window };
  globalThis.URL = { createObjectURL: (blob) => { created.push(blob); return `blob:${created.length}`; },
    revokeObjectURL: (url) => revoked.push(url) };
  globalThis.document = { createElement: () => ({ click() { clicks.push({ href: this.href, name: this.download }); } }) };
  globalThis.window = { addEventListener() {} };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  return { created, revoked, clicks };
}

test("a blob download keeps its object URL for a minute, since iOS prompts fetch it late", (t) => {
  const h = browser(t), blob = new Blob(["{}"]);
  downloadBlob(blob, "backup.json");
  assert.deepEqual(h.created, [blob]); assert.deepEqual(h.clicks, [{ href: "blob:1", name: "backup.json" }]);
  t.mock.timers.tick(3000);
  assert.deepEqual(h.revoked, [], "three seconds is too short for a late download prompt");
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME - 3000);
  assert.deepEqual(h.revoked, ["blob:1"]); assert.equal(DOWNLOAD_URL_LIFETIME, 60000);
});

test("a URL the caller keeps is reused and never revoked by the download", (t) => {
  const h = browser(t);
  downloadBlob(new Blob(["png"]), "scan.png", "blob:gallery");
  t.mock.timers.tick(2 * DOWNLOAD_URL_LIFETIME);
  assert.deepEqual(h.created, []); assert.deepEqual(h.revoked, []);
  assert.deepEqual(h.clicks, [{ href: "blob:gallery", name: "scan.png" }]);
});

test("the diagnostic report download uses the shared URL lifetime", (t) => {
  const h = browser(t), nodes = new Map();
  const get = (key) => { if (!nodes.has(key)) nodes.set(key, { textContent: "", checked: false, removeAttribute(name) { delete this[name]; } }); return nodes.get(key); };
  const panel = { querySelector: (selector) => get(selector.match(/"([^"\]]+)"/)[1]), addEventListener() {} };
  const diagnostics = createScanDiagnostics();
  setupDiagnosticsUI({ $: (id) => id === "scan-diagnostics" ? panel : null, diagnostics, getSource: () => ({ image: null, verified: false }) });
  diagnostics.begin("photo", {}); diagnostics.event({ stage: "reading", reason: "full-read" });
  get("prepare").onclick(); get("download").onclick();
  assert.deepEqual(h.clicks, [{ href: "blob:1", name: "gridpuzzle-diagnostic.json" }]);
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME - 1); assert.deepEqual(h.revoked, []);
  t.mock.timers.tick(1); assert.deepEqual(h.revoked, ["blob:1"]);
});

test("every runtime download link goes through the shared helper", () => {
  const web = new URL("../", import.meta.url);
  for (const name of readdirSync(web).filter((file) => file.endsWith(".js") && file !== "download.js")) {
    const source = readFileSync(new URL(name, web), "utf8");
    assert.equal(/\.download\s*=/.test(source), false, `${name} builds its own download link`);
  }
});
