import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// How photo_read's stale-build check (scripts/stale_build_checks.cjs) hands
// the newspaper photo to the page and waits for the app's answer, with a page
// that runs the check's own page functions over a stand-in for the app's
// status line. Loading the suite needs no Playwright: the harness loads it
// only when a suite runs. The check resolves its photo and site from the
// working directory when it loads, as photo_read runs it from the repository
// root, so it is loaded from there whichever directory the tests run from
// (web/package.json's test script runs them from web/).
const { choosePhoto } = fromRoot(() => createRequire(import.meta.url)("../../scripts/stale_build_checks.cjs"));
const PHOTO = new URL("../../Examples/BrowserScanner/Newspaper/2026-09-07-sudoku.webp", import.meta.url);

function fromRoot(load) {
  const cwd = process.cwd();
  process.chdir(fileURLToPath(new URL("../..", import.meta.url)));
  try { return load(); } finally { process.chdir(cwd); }
}

// The status line as app.js's status() writes it: the class, then the text,
// a new text node each time.
function app(shown) {
  const status = { className: "", classList: { contains: (name) => status.className.split(" ").includes(name) } };
  const line = { firstChild: null, get textContent() { return this.firstChild?.data ?? ""; } };
  const show = ({ text, kind = "info" }) => { status.className = `status ${kind}`; line.firstChild = { data: text }; };
  show(shown);
  const elements = { status, "status-text": line, "auto-solve": { checked: true } };
  return { show, elements, document: { getElementById: (id) => elements[id] }, window: {} };
}
// A page over `state` on which the app, once a photo is chosen, shows
// `statuses` one after another: the first as the photo is chosen, each later
// one before waitForFunction looks again, as the app goes on from "Finding
// the grid…" to its answer while the check polls. A null shows nothing new
// at that look; with no statuses the app never answers. waitForFunction
// times out unless its function returns a value at one of its looks.
function page(state, ...statuses) {
  const run = (fn, arg) => {
    const saved = [globalThis.document, globalThis.window];
    Object.assign(globalThis, { document: state.document, window: state.window });
    try { return fn(arg); } finally { [globalThis.document, globalThis.window] = saved; }
  };
  const show = () => { const next = statuses.shift(); if (next) state.show(next); };
  return {
    chosen: [],
    async evaluate(fn, arg) { return run(fn, arg); },
    async setInputFiles(selector, files) { this.chosen.push({ selector, files }); show(); },
    async waitForFunction(fn, arg, { timeout }) {
      for (;;) {
        const value = run(fn, arg);
        if (value) return { jsonValue: async () => structuredClone(value) };
        if (!statuses.length) throw Error(`page.waitForFunction: Timeout ${timeout}ms exceeded.`);
        show();
      }
    },
  };
}
const READY = { text: "Ready when you are." };
// What the app may show between the choice and its answer: its progress
// (photo-flow.js, detectPhoto) and, where the browser cannot store the
// puzzle, the warning it gives once when choosing the photo stores it
// (app.js, storage.set).
const FINDING = { text: "Finding the grid…" };
const NOT_SAVED = { text: "Your puzzle is not being saved in this browser.", kind: "warning" };

test("the stale-build check hands the page the photo's bytes, never its path", async () => {
  const state = app(READY), browser = page(state, { text: "Grid found." });
  await choosePhoto(browser);
  assert.equal(browser.chosen.length, 1);
  const [{ selector, files }] = browser.chosen;
  assert.equal(selector, "#photo-file");
  // Given a path, Playwright lets WebKit open the file, which WebKit on
  // Windows may refuse when it was last modified on a whole second.
  assert.equal(typeof files, "object", `chosen by path: ${files}`);
  assert.equal(files.name, "2026-09-07-sudoku.webp");
  assert.equal(files.mimeType, "image/webp");
  assert.deepEqual(files.buffer, readFileSync(PHOTO));
  assert.equal(state.elements["auto-solve"].checked, false);
});

test("the photo is taken when the app finds its grid or asks for the corners", async () => {
  for (const text of ["Grid found.", "Set the four crop corners."]) {
    await choosePhoto(page(app(READY), { text }));
    // Only an error refuses the photo: the check waits on through the app's
    // progress and any other notice until the app answers.
    await choosePhoto(page(app(READY), null, FINDING, { text }));
    await choosePhoto(page(app(READY), null, NOT_SAVED, { text }));
  }
});

test("a photo the app refuses ends the check at once with what the app said", async () => {
  const state = app(READY), browser = page(state, { text: "The object can not be found here.", kind: "error" });
  await assert.rejects(choosePhoto(browser), /the app refused the photo: The object can not be found here\./);
  // After the app has said it is looking for the grid, too.
  await assert.rejects(choosePhoto(page(app(READY), null, FINDING, { text: "The image is empty.", kind: "error" })),
    /the app refused the photo: The image is empty\./);
});

test("what the status line said before the photo was chosen neither takes nor refuses it", async () => {
  const earlier = [
    { text: "Recognition could not load. An updated version of the app is ready. Use “Update app & reload”, then try again.",
      kind: "error" },
    { text: "Grid found." },
  ];
  for (const shown of earlier) {
    // The app has not answered yet: the check keeps waiting.
    await assert.rejects(choosePhoto(page(app(shown))), /Timeout 120000ms exceeded/, shown.text);
    // Its answer then decides.
    await choosePhoto(page(app(shown), { text: "Grid found." }));
    await assert.rejects(choosePhoto(page(app(shown), { text: "The image is empty.", kind: "error" })),
      /the app refused the photo: The image is empty\./);
  }
});
